/**
 * Unit tests for simulation winners/winningTurns array persistence (SQLite).
 *
 * Run with: npx tsx test/simulation-wins.test.ts
 */

import {
  createJob,
  initializeSimulations,
  updateSimulationStatus,
  getSimulationStatuses,
  deleteJob,
  deleteSimulations,
} from '../lib/job-store';
import type { DeckSlot } from '../lib/types';

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

function assertArrayEqual<T>(actual: T[], expected: T[], message: string) {
  if (actual.length !== expected.length) {
    throw new Error(
      `${message}: length mismatch - expected ${expected.length}, got ${actual.length}`
    );
  }
  for (let i = 0; i < expected.length; i++) {
    if (actual[i] !== expected[i]) {
      throw new Error(
        `${message}: index ${i} mismatch - expected ${JSON.stringify(expected[i])}, got ${JSON.stringify(actual[i])}`
      );
    }
  }
}

// Helper to create a test job and return its ID
function createTestJob(): string {
  const decks: DeckSlot[] = [
    { name: 'Deck A', dck: 'a' },
    { name: 'Deck B', dck: 'b' },
    { name: 'Deck C', dck: 'c' },
    { name: 'Deck D', dck: 'd' },
  ];
  const job = createJob(decks, 8);
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
  console.log('Running simulation-wins unit tests...\n');

  await test('winners/winningTurns arrays round-trip through SQLite', () => {
    const jobId = createTestJob();
    try {
      initializeSimulations(jobId, 2);

      updateSimulationStatus(jobId, 'sim_000', {
        state: 'COMPLETED',
        winners: ['Deck A', 'Deck B', 'Deck A', 'Deck C'],
        winningTurns: [5, 8, 6, 7],
      });

      const sims = getSimulationStatuses(jobId);
      const sim0 = sims.find((s) => s.simId === 'sim_000')!;

      assert(sim0.winners !== undefined, 'winners should be defined');
      assertArrayEqual(sim0.winners!, ['Deck A', 'Deck B', 'Deck A', 'Deck C'], 'winners');
      assert(sim0.winningTurns !== undefined, 'winningTurns should be defined');
      assertArrayEqual(sim0.winningTurns!, [5, 8, 6, 7], 'winningTurns');
    } finally {
      cleanup(jobId);
    }
  });

  await test('singular winner/winningTurn still works (backward compat)', () => {
    const jobId = createTestJob();
    try {
      initializeSimulations(jobId, 1);

      updateSimulationStatus(jobId, 'sim_000', {
        state: 'COMPLETED',
        winner: 'Deck A',
        winningTurn: 10,
      });

      const sims = getSimulationStatuses(jobId);
      const sim0 = sims[0];

      assertEqual(sim0.winner, 'Deck A', 'winner');
      assertEqual(sim0.winningTurn, 10, 'winningTurn');
      assert(sim0.winners === undefined, 'winners should be undefined when not set');
      assert(sim0.winningTurns === undefined, 'winningTurns should be undefined when not set');
    } finally {
      cleanup(jobId);
    }
  });

  await test('empty winners array is persisted and returned', () => {
    const jobId = createTestJob();
    try {
      initializeSimulations(jobId, 1);

      updateSimulationStatus(jobId, 'sim_000', {
        state: 'COMPLETED',
        winners: [],
        winningTurns: [],
      });

      const sims = getSimulationStatuses(jobId);
      const sim0 = sims[0];

      assert(sim0.winners !== undefined, 'winners should be defined (empty array)');
      assertEqual(sim0.winners!.length, 0, 'winners length');
      assert(sim0.winningTurns !== undefined, 'winningTurns should be defined (empty array)');
      assertEqual(sim0.winningTurns!.length, 0, 'winningTurns length');
    } finally {
      cleanup(jobId);
    }
  });

  await test('mixed data: some sims with arrays, some singular, some neither', () => {
    const jobId = createTestJob();
    try {
      initializeSimulations(jobId, 3);

      // Sim 0: arrays (multi-game container)
      updateSimulationStatus(jobId, 'sim_000', {
        state: 'COMPLETED',
        winners: ['Deck A', 'Deck B'],
        winningTurns: [5, 8],
      });

      // Sim 1: singular (legacy format)
      updateSimulationStatus(jobId, 'sim_001', {
        state: 'COMPLETED',
        winner: 'Deck C',
        winningTurn: 12,
      });

      // Sim 2: still pending (no win data)

      const sims = getSimulationStatuses(jobId);

      // Sim 0: has arrays
      const sim0 = sims.find((s) => s.simId === 'sim_000')!;
      assertArrayEqual(sim0.winners!, ['Deck A', 'Deck B'], 'sim0 winners');
      assertArrayEqual(sim0.winningTurns!, [5, 8], 'sim0 winningTurns');
      assert(sim0.winner === undefined, 'sim0 should not have singular winner');

      // Sim 1: has singular
      const sim1 = sims.find((s) => s.simId === 'sim_001')!;
      assertEqual(sim1.winner, 'Deck C', 'sim1 winner');
      assertEqual(sim1.winningTurn, 12, 'sim1 winningTurn');
      assert(sim1.winners === undefined, 'sim1 should not have winners array');

      // Sim 2: no win data
      const sim2 = sims.find((s) => s.simId === 'sim_002')!;
      assertEqual(sim2.state, 'PENDING', 'sim2 state');
      assert(sim2.winner === undefined, 'sim2 should not have winner');
      assert(sim2.winners === undefined, 'sim2 should not have winners');
      assert(sim2.winningTurn === undefined, 'sim2 should not have winningTurn');
      assert(sim2.winningTurns === undefined, 'sim2 should not have winningTurns');
    } finally {
      cleanup(jobId);
    }
  });

  await test('both singular and array fields can coexist on same simulation', () => {
    const jobId = createTestJob();
    try {
      initializeSimulations(jobId, 1);

      updateSimulationStatus(jobId, 'sim_000', {
        state: 'COMPLETED',
        winner: 'Deck A',
        winningTurn: 5,
        winners: ['Deck A', 'Deck B', 'Deck A', 'Deck D'],
        winningTurns: [5, 8, 6, 7],
      });

      const sims = getSimulationStatuses(jobId);
      const sim0 = sims[0];

      assertEqual(sim0.winner, 'Deck A', 'singular winner');
      assertEqual(sim0.winningTurn, 5, 'singular winningTurn');
      assertArrayEqual(sim0.winners!, ['Deck A', 'Deck B', 'Deck A', 'Deck D'], 'winners array');
      assertArrayEqual(sim0.winningTurns!, [5, 8, 6, 7], 'winningTurns array');
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
