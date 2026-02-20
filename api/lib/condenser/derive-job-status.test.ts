/**
 * Tests for deriveJobStatus — maps simulation states to job status.
 *
 * Pure function: SimulationStatus[] → JobStatus | null.
 * No I/O, no side effects.
 *
 * Run with: npx tsx lib/condenser/derive-job-status.test.ts
 */

import type { SimulationStatus, SimulationState } from '../types';
import { deriveJobStatus } from '../job-store-factory';

// ---------------------------------------------------------------------------
// Test Utilities (same pattern as condenser.test.ts)
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

/** Create a minimal SimulationStatus with the given state. */
function sim(state: SimulationState, index: number = 0): SimulationStatus {
  return {
    simId: `sim_${String(index).padStart(3, '0')}`,
    index,
    state,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function runTests() {
  console.log('Running deriveJobStatus tests...\n');

  await test('empty array returns null', () => {
    assertEqual(deriveJobStatus([]), null, 'empty input');
  });

  await test('all PENDING returns QUEUED', () => {
    assertEqual(
      deriveJobStatus([sim('PENDING', 0), sim('PENDING', 1), sim('PENDING', 2)]),
      'QUEUED',
      'all PENDING'
    );
  });

  await test('all COMPLETED returns COMPLETED', () => {
    assertEqual(
      deriveJobStatus([sim('COMPLETED', 0), sim('COMPLETED', 1), sim('COMPLETED', 2)]),
      'COMPLETED',
      'all COMPLETED'
    );
  });

  await test('all FAILED returns FAILED', () => {
    assertEqual(
      deriveJobStatus([sim('FAILED', 0), sim('FAILED', 1), sim('FAILED', 2)]),
      'FAILED',
      'all FAILED'
    );
  });

  await test('all CANCELLED returns CANCELLED', () => {
    assertEqual(
      deriveJobStatus([sim('CANCELLED', 0), sim('CANCELLED', 1), sim('CANCELLED', 2)]),
      'CANCELLED',
      'all CANCELLED'
    );
  });

  await test('any RUNNING returns RUNNING', () => {
    assertEqual(
      deriveJobStatus([sim('COMPLETED', 0), sim('RUNNING', 1), sim('PENDING', 2)]),
      'RUNNING',
      'has RUNNING'
    );
  });

  await test('mix PENDING + COMPLETED returns RUNNING', () => {
    assertEqual(
      deriveJobStatus([sim('PENDING', 0), sim('COMPLETED', 1), sim('PENDING', 2)]),
      'RUNNING',
      'PENDING + COMPLETED mix'
    );
  });

  await test('mix COMPLETED + FAILED returns COMPLETED', () => {
    assertEqual(
      deriveJobStatus([sim('COMPLETED', 0), sim('COMPLETED', 1), sim('FAILED', 2)]),
      'COMPLETED',
      'COMPLETED + FAILED mix'
    );
  });

  await test('mix CANCELLED + COMPLETED returns COMPLETED', () => {
    assertEqual(
      deriveJobStatus([sim('CANCELLED', 0), sim('COMPLETED', 1), sim('COMPLETED', 2)]),
      'COMPLETED',
      'CANCELLED + COMPLETED mix'
    );
  });

  await test('CANCELLED + FAILED (no COMPLETED) returns CANCELLED', () => {
    assertEqual(
      deriveJobStatus([sim('CANCELLED', 0), sim('CANCELLED', 1), sim('FAILED', 2)]),
      'CANCELLED',
      'CANCELLED + FAILED mix'
    );
  });

  await test('single COMPLETED returns COMPLETED', () => {
    assertEqual(
      deriveJobStatus([sim('COMPLETED', 0)]),
      'COMPLETED',
      'single COMPLETED'
    );
  });

  await test('single PENDING returns QUEUED', () => {
    assertEqual(
      deriveJobStatus([sim('PENDING', 0)]),
      'QUEUED',
      'single PENDING'
    );
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
