/**
 * Tests for conditionalUpdateSimulationStatus (status transition guards).
 *
 * Uses real SQLite following the pattern in test/simulation-wins.test.ts.
 *
 * Run with: npx tsx lib/store-guards.test.ts
 */

import {
  createJob,
  initializeSimulations,
  updateSimulationStatus,
  conditionalUpdateSimulationStatus,
  getSimulationStatus,
  deleteSimulations,
  deleteJob,
} from './job-store';
import type { DeckSlot } from './types';

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

const DECKS: DeckSlot[] = [
  { name: 'Deck A', dck: 'a' },
  { name: 'Deck B', dck: 'b' },
  { name: 'Deck C', dck: 'c' },
  { name: 'Deck D', dck: 'd' },
];

function createTestJob(): string {
  return createJob(DECKS, 8).id;
}

function cleanup(jobId: string) {
  deleteSimulations(jobId);
  deleteJob(jobId);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function runTests() {
  console.log('Running store-guards tests...\n');

  // =========================================================================
  // conditionalUpdateSimulationStatus
  // =========================================================================

  await test('applies update when sim is in expected state (PENDING → COMPLETED)', () => {
    const jobId = createTestJob();
    try {
      initializeSimulations(jobId, 2);
      const updated = conditionalUpdateSimulationStatus(jobId, 'sim_000', ['PENDING'], {
        state: 'COMPLETED',
        winner: 'Deck A',
      });
      assertEqual(updated, true, 'should return true');
      const sim = getSimulationStatus(jobId, 'sim_000');
      assertEqual(sim!.state, 'COMPLETED', 'state should be COMPLETED');
      assertEqual(sim!.winner, 'Deck A', 'winner should be set');
    } finally {
      cleanup(jobId);
    }
  });

  await test('rejects update when sim NOT in expected states (COMPLETED → RUNNING)', () => {
    const jobId = createTestJob();
    try {
      initializeSimulations(jobId, 1);
      // First: set to COMPLETED
      updateSimulationStatus(jobId, 'sim_000', { state: 'COMPLETED' });
      // Try conditional update expecting RUNNING
      const updated = conditionalUpdateSimulationStatus(jobId, 'sim_000', ['RUNNING'], {
        state: 'RUNNING',
      });
      assertEqual(updated, false, 'should return false');
      const sim = getSimulationStatus(jobId, 'sim_000');
      assertEqual(sim!.state, 'COMPLETED', 'state should still be COMPLETED');
    } finally {
      cleanup(jobId);
    }
  });

  await test('allows COMPLETED from FAILED (retry path)', () => {
    const jobId = createTestJob();
    try {
      initializeSimulations(jobId, 1);
      updateSimulationStatus(jobId, 'sim_000', { state: 'FAILED', errorMessage: 'timeout' });
      const updated = conditionalUpdateSimulationStatus(jobId, 'sim_000', ['PENDING', 'RUNNING', 'FAILED'], {
        state: 'COMPLETED',
        winner: 'Deck B',
      });
      assertEqual(updated, true, 'should return true');
      const sim = getSimulationStatus(jobId, 'sim_000');
      assertEqual(sim!.state, 'COMPLETED', 'state should be COMPLETED');
    } finally {
      cleanup(jobId);
    }
  });

  await test('allows COMPLETED from RUNNING (normal path)', () => {
    const jobId = createTestJob();
    try {
      initializeSimulations(jobId, 1);
      updateSimulationStatus(jobId, 'sim_000', { state: 'RUNNING' });
      const updated = conditionalUpdateSimulationStatus(jobId, 'sim_000', ['PENDING', 'RUNNING', 'FAILED'], {
        state: 'COMPLETED',
      });
      assertEqual(updated, true, 'should return true');
    } finally {
      cleanup(jobId);
    }
  });

  await test('returns false for empty update object', () => {
    const jobId = createTestJob();
    try {
      initializeSimulations(jobId, 1);
      const updated = conditionalUpdateSimulationStatus(jobId, 'sim_000', ['PENDING'], {});
      assertEqual(updated, false, 'empty update should return false');
    } finally {
      cleanup(jobId);
    }
  });

  // =========================================================================
  // Terminal state semantics (integration scenarios)
  // =========================================================================

  await test('COMPLETED sim rejects RUNNING regression (Pub/Sub redelivery scenario)', () => {
    const jobId = createTestJob();
    try {
      initializeSimulations(jobId, 1);
      updateSimulationStatus(jobId, 'sim_000', { state: 'COMPLETED', winner: 'Deck C' });
      // Simulate a stale Pub/Sub redelivery trying to set back to RUNNING
      const updated = conditionalUpdateSimulationStatus(jobId, 'sim_000', ['PENDING', 'RUNNING'], {
        state: 'RUNNING',
        workerId: 'stale-worker',
      });
      assertEqual(updated, false, 'should reject regression');
      const sim = getSimulationStatus(jobId, 'sim_000');
      assertEqual(sim!.state, 'COMPLETED', 'state should remain COMPLETED');
      assertEqual(sim!.winner, 'Deck C', 'winner should be preserved');
    } finally {
      cleanup(jobId);
    }
  });

  await test('CANCELLED sim rejects state transitions', () => {
    const jobId = createTestJob();
    try {
      initializeSimulations(jobId, 1);
      updateSimulationStatus(jobId, 'sim_000', { state: 'CANCELLED' });
      // Try to transition to RUNNING
      const updated1 = conditionalUpdateSimulationStatus(jobId, 'sim_000', ['PENDING', 'RUNNING'], {
        state: 'RUNNING',
      });
      assertEqual(updated1, false, 'should reject CANCELLED → RUNNING');
      // Try to transition to COMPLETED
      const updated2 = conditionalUpdateSimulationStatus(jobId, 'sim_000', ['PENDING', 'RUNNING', 'FAILED'], {
        state: 'COMPLETED',
      });
      assertEqual(updated2, false, 'should reject CANCELLED → COMPLETED');
    } finally {
      cleanup(jobId);
    }
  });

  await test('PENDING sim allows transition to RUNNING', () => {
    const jobId = createTestJob();
    try {
      initializeSimulations(jobId, 1);
      const updated = conditionalUpdateSimulationStatus(jobId, 'sim_000', ['PENDING'], {
        state: 'RUNNING',
        workerId: 'worker-1',
        startedAt: new Date().toISOString(),
      });
      assertEqual(updated, true, 'should allow PENDING → RUNNING');
      const sim = getSimulationStatus(jobId, 'sim_000');
      assertEqual(sim!.state, 'RUNNING', 'state should be RUNNING');
      assertEqual(sim!.workerId, 'worker-1', 'workerId should be set');
    } finally {
      cleanup(jobId);
    }
  });

  await test('multiple expected states: matches any one', () => {
    const jobId = createTestJob();
    try {
      initializeSimulations(jobId, 1);
      updateSimulationStatus(jobId, 'sim_000', { state: 'FAILED' });
      // FAILED is in the expected list
      const updated = conditionalUpdateSimulationStatus(jobId, 'sim_000', ['PENDING', 'FAILED'], {
        state: 'PENDING',
      });
      assertEqual(updated, true, 'should match FAILED from [PENDING, FAILED]');
    } finally {
      cleanup(jobId);
    }
  });

  await test('nonexistent sim returns false', () => {
    const jobId = createTestJob();
    try {
      initializeSimulations(jobId, 1);
      const updated = conditionalUpdateSimulationStatus(jobId, 'sim_999', ['PENDING'], {
        state: 'RUNNING',
      });
      assertEqual(updated, false, 'nonexistent sim should return false');
    } finally {
      cleanup(jobId);
    }
  });

  // =========================================================================
  // Summary
  // =========================================================================

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
