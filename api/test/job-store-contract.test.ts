/**
 * Job store factory contract tests.
 *
 * These tests exercise the factory's exported functions (not the concrete
 * stores directly) and assert on return shapes. This catches behavioral
 * divergence between SQLite and Firestore implementations.
 *
 * Currently runs against SQLite (LOCAL mode, GOOGLE_CLOUD_PROJECT unset).
 * To test Firestore parity, run with:
 *   GOOGLE_CLOUD_PROJECT=demo-test FIRESTORE_EMULATOR_HOST=localhost:8080 npx tsx test/job-store-contract.test.ts
 *
 * Run with: npx tsx test/job-store-contract.test.ts
 */

import * as jobStore from '../lib/job-store-factory';
import type { DeckSlot, Job, SimulationStatus } from '../lib/types';

// ---------------------------------------------------------------------------
// Test Utilities
// ---------------------------------------------------------------------------

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
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_DECKS: DeckSlot[] = [
  { name: 'Contract Test A', dck: 'deck_a_content' },
  { name: 'Contract Test B', dck: 'deck_b_content' },
  { name: 'Contract Test C', dck: 'deck_c_content' },
  { name: 'Contract Test D', dck: 'deck_d_content' },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function runTests() {
  const mode = jobStore.isGcpMode() ? 'GCP (Firestore)' : 'LOCAL (SQLite)';
  console.log(`Running job store contract tests in ${mode} mode...\n`);

  // =========================================================================
  // createJob → returns Job with all required fields
  // =========================================================================

  let createdJobId: string;

  await test('createJob returns a Job with all required fields', async () => {
    const job = await jobStore.createJob(TEST_DECKS, 8, {
      parallelism: 4,
      deckIds: ['deck-1', 'deck-2', 'deck-3', 'deck-4'],
    });

    createdJobId = job.id;

    assert(typeof job.id === 'string' && job.id.length > 0, 'id should be non-empty string');
    assert(Array.isArray(job.decks) && job.decks.length === 4, 'decks should be array of 4');
    assertEqual(job.status, 'QUEUED', 'status');
    assertEqual(job.simulations, 8, 'simulations');
    assert(job.createdAt instanceof Date, 'createdAt should be Date');
    assert(job.results === undefined || job.results === null, 'results should be null/undefined initially');
  });

  // =========================================================================
  // getJob → returns same shape as createJob
  // =========================================================================

  await test('getJob returns same shape as createJob', async () => {
    const job = await jobStore.getJob(createdJobId);
    assert(job !== null, 'job should exist');
    assert(typeof job!.id === 'string', 'id');
    assertEqual(job!.status, 'QUEUED', 'status');
    assertEqual(job!.simulations, 8, 'simulations');
    assert(job!.createdAt instanceof Date, 'createdAt should be Date');
    assert(Array.isArray(job!.decks), 'decks should be array');
  });

  await test('getJob returns null for nonexistent ID', async () => {
    const job = await jobStore.getJob('nonexistent-id-12345');
    assertEqual(job, null, 'should be null');
  });

  // =========================================================================
  // initializeSimulations + getSimulationStatuses
  // =========================================================================

  await test('initializeSimulations creates correct number of sims', async () => {
    await jobStore.initializeSimulations(createdJobId, 2);
    const sims = await jobStore.getSimulationStatuses(createdJobId);
    assertEqual(sims.length, 2, 'should have 2 simulations');
  });

  await test('simulation statuses have correct initial shape', async () => {
    const sims = await jobStore.getSimulationStatuses(createdJobId);
    for (const sim of sims) {
      assert(typeof sim.simId === 'string' && sim.simId.length > 0, `simId should be non-empty: ${sim.simId}`);
      assert(typeof sim.index === 'number', `index should be number: ${sim.index}`);
      assertEqual(sim.state, 'PENDING', `state should be PENDING: ${sim.state}`);
    }
  });

  // =========================================================================
  // updateSimulationStatus → state transitions
  // =========================================================================

  await test('updateSimulationStatus transitions PENDING → RUNNING', async () => {
    const sims = await jobStore.getSimulationStatuses(createdJobId);
    const simId = sims[0].simId;

    await jobStore.updateSimulationStatus(createdJobId, simId, {
      state: 'RUNNING',
      startedAt: new Date().toISOString(),
      workerId: 'test-worker',
    });

    const updated = await jobStore.getSimulationStatus(createdJobId, simId);
    assert(updated !== null, 'sim should exist after update');
    assertEqual(updated!.state, 'RUNNING', 'state should be RUNNING');
    assert(typeof updated!.startedAt === 'string', 'startedAt should be set');
  });

  await test('updateSimulationStatus transitions RUNNING → COMPLETED', async () => {
    const sims = await jobStore.getSimulationStatuses(createdJobId);
    const simId = sims[0].simId;

    await jobStore.updateSimulationStatus(createdJobId, simId, {
      state: 'COMPLETED',
      completedAt: new Date().toISOString(),
      durationMs: 5000,
      winners: ['Contract Test A', 'Contract Test B'],
      winningTurns: [8, 12],
    });

    const updated = await jobStore.getSimulationStatus(createdJobId, simId);
    assertEqual(updated!.state, 'COMPLETED', 'state should be COMPLETED');
    assert(typeof updated!.durationMs === 'number', 'durationMs should be set');
  });

  // =========================================================================
  // incrementCompletedSimCount → returns { completedSimCount, totalSimCount }
  // =========================================================================

  await test('incrementCompletedSimCount returns correct shape', async () => {
    const result = await jobStore.incrementCompletedSimCount(createdJobId);
    assert('completedSimCount' in result, 'should have completedSimCount');
    assert('totalSimCount' in result, 'should have totalSimCount');
    assert(typeof result.completedSimCount === 'number', 'completedSimCount should be number');
    assert(typeof result.totalSimCount === 'number', 'totalSimCount should be number');
    assert(result.completedSimCount >= 1, 'completedSimCount should be >= 1');
  });

  // =========================================================================
  // conditionalUpdateSimulationStatus → terminal state guard
  // =========================================================================

  await test('conditionalUpdateSimulationStatus rejects COMPLETED → RUNNING regression', async () => {
    const sims = await jobStore.getSimulationStatuses(createdJobId);
    const completedSim = sims.find(s => s.state === 'COMPLETED');
    assert(completedSim !== undefined, 'should have a COMPLETED sim');

    const result = await jobStore.conditionalUpdateSimulationStatus(
      createdJobId,
      completedSim!.simId,
      ['PENDING', 'RUNNING'], // Only update if in these states
      { state: 'RUNNING' },
    );
    assertEqual(result, false, 'should reject regression from COMPLETED');
  });

  // =========================================================================
  // setJobStartedAt / setJobCompleted
  // =========================================================================

  await test('setJobStartedAt records start time and worker info', async () => {
    await jobStore.setJobStartedAt(createdJobId, 'test-worker', 'Test Worker');
    const job = await jobStore.getJob(createdJobId);
    assert(job!.startedAt instanceof Date, 'startedAt should be Date');
    assertEqual(job!.workerId, 'test-worker', 'workerId');
    assertEqual(job!.workerName, 'Test Worker', 'workerName');
  });

  await test('setJobCompleted updates job status to COMPLETED', async () => {
    await jobStore.setJobCompleted(createdJobId, [1000, 2000]);
    const job = await jobStore.getJob(createdJobId);
    assertEqual(job!.status, 'COMPLETED', 'status should be COMPLETED');
    assert(job!.completedAt instanceof Date, 'completedAt should be Date');
    assert(Array.isArray(job!.dockerRunDurationsMs), 'dockerRunDurationsMs should be array');
  });

  // =========================================================================
  // setJobResults
  // =========================================================================

  await test('setJobResults stores results and getJob returns them', async () => {
    const testResults = {
      wins: { 'Contract Test A': 5, 'Contract Test B': 3 },
      avgWinTurn: { 'Contract Test A': 8, 'Contract Test B': 12 },
      gamesPlayed: 8,
    };
    await jobStore.setJobResults(createdJobId, testResults);
    const job = await jobStore.getJob(createdJobId);
    assert(job!.results !== null && job!.results !== undefined, 'results should be set');
    assertEqual(job!.results!.gamesPlayed, 8, 'gamesPlayed');
    assertEqual(job!.results!.wins['Contract Test A'], 5, 'wins for Deck A');
  });

  // =========================================================================
  // deriveJobStatus (pure function, should be consistent)
  // =========================================================================

  await test('deriveJobStatus works with current simulations', () => {
    const derived = jobStore.deriveJobStatus([
      { simId: 'a', index: 0, state: 'COMPLETED' } as SimulationStatus,
      { simId: 'b', index: 1, state: 'COMPLETED' } as SimulationStatus,
    ]);
    assertEqual(derived, 'COMPLETED', 'all COMPLETED → COMPLETED');
  });

  await test('deriveJobStatus: mix of COMPLETED + RUNNING → RUNNING', () => {
    const derived = jobStore.deriveJobStatus([
      { simId: 'a', index: 0, state: 'COMPLETED' } as SimulationStatus,
      { simId: 'b', index: 1, state: 'RUNNING' } as SimulationStatus,
    ]);
    assertEqual(derived, 'RUNNING', 'COMPLETED + RUNNING → RUNNING');
  });

  // =========================================================================
  // Cleanup
  // =========================================================================

  await test('deleteSimulations + deleteJob cleans up', async () => {
    await jobStore.deleteSimulations(createdJobId);
    await jobStore.deleteJob(createdJobId);
    const job = await jobStore.getJob(createdJobId);
    assertEqual(job, null, 'job should be deleted');
  });

  // =========================================================================
  // Summary
  // =========================================================================

  console.log('\n--- Test Summary ---');
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`Passed: ${passed}/${results.length}`);
  console.log(`Failed: ${failed}/${results.length}`);
  console.log(`Mode: ${mode}`);

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
