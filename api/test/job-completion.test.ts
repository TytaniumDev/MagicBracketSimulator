/**
 * Tests for the job completion flow: simulation completion → counter check → job status.
 *
 * Verifies that:
 * - All simulations completing triggers the job to be marked COMPLETED
 * - Partial completion keeps the job RUNNING
 * - Conditional updates prevent double-counting
 * - deriveJobStatus returns correct status for various simulation states
 *
 * Run with: npx tsx test/job-completion.test.ts
 */

import {
  createJob,
  getJob,
  initializeSimulations,
  updateSimulationStatus,
  getSimulationStatuses,
  conditionalUpdateSimulationStatus,
  setJobCompleted,
  updateJobStatus,
  deleteJob,
  deleteSimulations,
} from '../lib/job-store';
import { incrementCompletedSimCount, deriveJobStatus } from '../lib/job-store-factory';
import type { DeckSlot, SimulationStatus } from '../lib/types';

// -----------------------------------------------------------------------------
// Test Utilities
// -----------------------------------------------------------------------------

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log(`✓ ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({ name, passed: false, error: message });
    console.log(`✗ ${name}`);
    console.log(`  Error: ${message}`);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// Helper to create a test job and return its ID
function createTestJob(simulations = 8): string {
  const decks: DeckSlot[] = [
    { name: 'Deck A', dck: 'a' },
    { name: 'Deck B', dck: 'b' },
    { name: 'Deck C', dck: 'c' },
    { name: 'Deck D', dck: 'd' },
  ];
  const job = createJob(decks, simulations);
  return job.id;
}

function cleanup(jobId: string) {
  deleteSimulations(jobId);
  deleteJob(jobId);
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

async function runTests() {
  console.log('Running job-completion tests...\n');

  await test('all simulations completing triggers correct counter values', async () => {
    const jobId = createTestJob(12); // 12 games = 3 containers (GAMES_PER_CONTAINER=4)
    try {
      initializeSimulations(jobId, 3);
      updateJobStatus(jobId, 'RUNNING');

      // Complete sim_000
      conditionalUpdateSimulationStatus(jobId, 'sim_000', ['PENDING', 'RUNNING'], {
        state: 'COMPLETED',
        winners: ['Deck A', 'Deck B', 'Deck A', 'Deck C'],
        winningTurns: [5, 8, 6, 7],
      });
      let counts = await incrementCompletedSimCount(jobId);
      assertEqual(counts.completedSimCount, 1, 'completedSimCount after sim_000');
      assertEqual(counts.totalSimCount, 3, 'totalSimCount after sim_000');

      // Complete sim_001
      conditionalUpdateSimulationStatus(jobId, 'sim_001', ['PENDING', 'RUNNING'], {
        state: 'COMPLETED',
        winners: ['Deck B', 'Deck D', 'Deck A', 'Deck B'],
        winningTurns: [10, 5, 8, 9],
      });
      counts = await incrementCompletedSimCount(jobId);
      assertEqual(counts.completedSimCount, 2, 'completedSimCount after sim_001');

      // Complete sim_002 — this is the last one
      conditionalUpdateSimulationStatus(jobId, 'sim_002', ['PENDING', 'RUNNING'], {
        state: 'COMPLETED',
        winners: ['Deck C', 'Deck A', 'Deck D', 'Deck B'],
        winningTurns: [7, 6, 11, 8],
      });
      counts = await incrementCompletedSimCount(jobId);
      assertEqual(counts.completedSimCount, 3, 'completedSimCount after sim_002');
      assertEqual(counts.totalSimCount, 3, 'totalSimCount after sim_002');

      // Counter check should now pass
      assert(
        counts.completedSimCount >= counts.totalSimCount && counts.totalSimCount > 0,
        'completion check should pass when all sims are done'
      );

      // Simulate what aggregateJobResults does at the end
      setJobCompleted(jobId);
      const job = getJob(jobId);
      assertEqual(job?.status, 'COMPLETED', 'job status after setJobCompleted');
    } finally {
      cleanup(jobId);
    }
  });

  await test('job stays RUNNING when not all sims are done', async () => {
    const jobId = createTestJob(12);
    try {
      initializeSimulations(jobId, 3);
      updateJobStatus(jobId, 'RUNNING');

      // Complete only 2 of 3 sims
      conditionalUpdateSimulationStatus(jobId, 'sim_000', ['PENDING', 'RUNNING'], {
        state: 'COMPLETED',
      });
      await incrementCompletedSimCount(jobId);

      conditionalUpdateSimulationStatus(jobId, 'sim_001', ['PENDING', 'RUNNING'], {
        state: 'COMPLETED',
      });
      const counts = await incrementCompletedSimCount(jobId);

      assertEqual(counts.completedSimCount, 2, 'completedSimCount');
      assertEqual(counts.totalSimCount, 3, 'totalSimCount');
      assert(
        counts.completedSimCount < counts.totalSimCount,
        'completion check should NOT pass when sims are incomplete'
      );

      // Job should still be RUNNING
      const job = getJob(jobId);
      assertEqual(job?.status, 'RUNNING', 'job status should remain RUNNING');
    } finally {
      cleanup(jobId);
    }
  });

  await test('conditional update prevents double-counting completed sims', async () => {
    const jobId = createTestJob(4);
    try {
      initializeSimulations(jobId, 1);
      updateJobStatus(jobId, 'RUNNING');

      // First COMPLETED transition — should succeed
      const firstTransitioned = conditionalUpdateSimulationStatus(
        jobId, 'sim_000', ['PENDING', 'RUNNING', 'FAILED'],
        { state: 'COMPLETED', winners: ['Deck A', 'Deck B', 'Deck C', 'Deck D'] }
      );
      assert(firstTransitioned, 'first COMPLETED transition should succeed');

      // Second COMPLETED transition — should fail (sim already COMPLETED)
      const secondTransitioned = conditionalUpdateSimulationStatus(
        jobId, 'sim_000', ['PENDING', 'RUNNING', 'FAILED'],
        { state: 'COMPLETED', winners: ['Deck A', 'Deck B', 'Deck C', 'Deck D'] }
      );
      assert(!secondTransitioned, 'second COMPLETED transition should be rejected');

      // Counter should reflect only one completion
      const counts = await incrementCompletedSimCount(jobId);
      // In local mode, incrementCompletedSimCount counts from sim states, so it should be 1
      assertEqual(counts.completedSimCount, 1, 'completedSimCount should be 1 (no double count)');
    } finally {
      cleanup(jobId);
    }
  });

  await test('deriveJobStatus: all COMPLETED → COMPLETED', () => {
    const sims: SimulationStatus[] = [
      { simId: 'sim_000', index: 0, state: 'COMPLETED' },
      { simId: 'sim_001', index: 1, state: 'COMPLETED' },
      { simId: 'sim_002', index: 2, state: 'COMPLETED' },
    ];
    assertEqual(deriveJobStatus(sims), 'COMPLETED', 'all COMPLETED → COMPLETED');
  });

  await test('deriveJobStatus: COMPLETED + CANCELLED → COMPLETED', () => {
    const sims: SimulationStatus[] = [
      { simId: 'sim_000', index: 0, state: 'COMPLETED' },
      { simId: 'sim_001', index: 1, state: 'COMPLETED' },
      { simId: 'sim_002', index: 2, state: 'CANCELLED' },
    ];
    assertEqual(deriveJobStatus(sims), 'COMPLETED', 'COMPLETED + CANCELLED → COMPLETED');
  });

  await test('deriveJobStatus: some RUNNING → RUNNING', () => {
    const sims: SimulationStatus[] = [
      { simId: 'sim_000', index: 0, state: 'COMPLETED' },
      { simId: 'sim_001', index: 1, state: 'RUNNING' },
      { simId: 'sim_002', index: 2, state: 'PENDING' },
    ];
    assertEqual(deriveJobStatus(sims), 'RUNNING', 'some RUNNING → RUNNING');
  });

  await test('deriveJobStatus: all PENDING → QUEUED', () => {
    const sims: SimulationStatus[] = [
      { simId: 'sim_000', index: 0, state: 'PENDING' },
      { simId: 'sim_001', index: 1, state: 'PENDING' },
    ];
    assertEqual(deriveJobStatus(sims), 'QUEUED', 'all PENDING → QUEUED');
  });

  await test('deriveJobStatus: all CANCELLED → CANCELLED', () => {
    const sims: SimulationStatus[] = [
      { simId: 'sim_000', index: 0, state: 'CANCELLED' },
      { simId: 'sim_001', index: 1, state: 'CANCELLED' },
    ];
    assertEqual(deriveJobStatus(sims), 'CANCELLED', 'all CANCELLED → CANCELLED');
  });

  await test('deriveJobStatus: all FAILED → FAILED', () => {
    const sims: SimulationStatus[] = [
      { simId: 'sim_000', index: 0, state: 'FAILED' },
      { simId: 'sim_001', index: 1, state: 'FAILED' },
    ];
    assertEqual(deriveJobStatus(sims), 'FAILED', 'all FAILED → FAILED');
  });

  await test('deriveJobStatus: empty → null', () => {
    assertEqual(deriveJobStatus([]), null, 'empty → null');
  });

  await test('CANCELLED sims count toward completion counter', async () => {
    const jobId = createTestJob(8);
    try {
      initializeSimulations(jobId, 2);
      updateJobStatus(jobId, 'RUNNING');

      // One COMPLETED, one CANCELLED
      conditionalUpdateSimulationStatus(jobId, 'sim_000', ['PENDING', 'RUNNING'], {
        state: 'COMPLETED',
        winners: ['Deck A', 'Deck B', 'Deck C', 'Deck D'],
      });

      updateSimulationStatus(jobId, 'sim_001', { state: 'CANCELLED' });

      const counts = await incrementCompletedSimCount(jobId);
      assertEqual(counts.completedSimCount, 2, 'COMPLETED + CANCELLED should both count');
      assert(
        counts.completedSimCount >= counts.totalSimCount,
        'completion check should pass with mix of COMPLETED and CANCELLED'
      );
    } finally {
      cleanup(jobId);
    }
  });

  await test('winners data is preserved through completion flow', async () => {
    const jobId = createTestJob(4);
    try {
      initializeSimulations(jobId, 1);
      updateJobStatus(jobId, 'RUNNING');

      const winners = ['Deck A', 'Deck B', 'Deck A', 'Deck C'];
      const winningTurns = [5, 8, 6, 7];

      conditionalUpdateSimulationStatus(jobId, 'sim_000', ['PENDING', 'RUNNING', 'FAILED'], {
        state: 'COMPLETED',
        winners,
        winningTurns,
      });

      const sims = getSimulationStatuses(jobId);
      const sim = sims.find(s => s.simId === 'sim_000')!;

      assert(sim.winners !== undefined, 'winners should be defined after completion');
      assertEqual(sim.winners!.length, 4, 'winners should have 4 entries');
      assertEqual(sim.winners![0], 'Deck A', 'first winner');
      assertEqual(sim.winners![2], 'Deck A', 'third winner');

      assert(sim.winningTurns !== undefined, 'winningTurns should be defined');
      assertEqual(sim.winningTurns!.length, 4, 'winningTurns should have 4 entries');
    } finally {
      cleanup(jobId);
    }
  });

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------

  console.log('\n--- Test Summary ---');
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`Passed: ${passed}/${results.length}`);
  console.log(`Failed: ${failed}/${results.length}`);

  if (failed > 0) {
    console.log('\nFailed tests:');
    results
      .filter((r) => !r.passed)
      .forEach((r) => {
        console.log(`  - ${r.name}: ${r.error}`);
      });
    process.exit(1);
  }

  console.log('\nAll tests passed!');
}

runTests().catch((error) => {
  console.error('Test runner error:', error);
  process.exit(1);
});
