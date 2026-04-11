/**
 * State machine tests for simulation and job lifecycle transitions.
 *
 * These tests verify that the shared state machine correctly accepts valid
 * transitions and rejects invalid ones — the primary defense against
 * regressions like COMPLETED→RUNNING from stale Pub/Sub redeliveries.
 *
 * Run with: npx tsx test/state-machine.test.ts
 */

import {
  canSimTransition,
  isTerminalSimState,
  canJobTransition,
  isTerminalJobState,
  TERMINAL_SIM_STATES,
  TERMINAL_JOB_STATES,
} from '@shared/types/state-machine';
import type { SimulationState } from '@shared/types/simulation';
import type { JobStatus } from '@shared/types/job';

// ---------------------------------------------------------------------------
// Test Utilities
// ---------------------------------------------------------------------------

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    results.push({ name, passed: true });
  } catch (err) {
    results.push({ name, passed: false, error: err instanceof Error ? err.message : String(err) });
  }
}

function assertEqual<T>(actual: T, expected: T, msg?: string) {
  if (actual !== expected) {
    throw new Error(msg ?? `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ---------------------------------------------------------------------------
// Simulation State Machine Tests
// ---------------------------------------------------------------------------

test('PENDING → RUNNING is valid', () => {
  assertEqual(canSimTransition('PENDING', 'RUNNING'), true);
});

test('PENDING → CANCELLED is valid', () => {
  assertEqual(canSimTransition('PENDING', 'CANCELLED'), true);
});

test('PENDING → COMPLETED is invalid (must go through RUNNING)', () => {
  assertEqual(canSimTransition('PENDING', 'COMPLETED'), false);
});

test('PENDING → FAILED is invalid (must go through RUNNING)', () => {
  assertEqual(canSimTransition('PENDING', 'FAILED'), false);
});

test('RUNNING → COMPLETED is valid', () => {
  assertEqual(canSimTransition('RUNNING', 'COMPLETED'), true);
});

test('RUNNING → FAILED is valid', () => {
  assertEqual(canSimTransition('RUNNING', 'FAILED'), true);
});

test('RUNNING → CANCELLED is valid', () => {
  assertEqual(canSimTransition('RUNNING', 'CANCELLED'), true);
});

test('RUNNING → PENDING is invalid (no backwards transition)', () => {
  assertEqual(canSimTransition('RUNNING', 'PENDING'), false);
});

test('COMPLETED → RUNNING is invalid (terminal state, prevents Pub/Sub regression)', () => {
  assertEqual(canSimTransition('COMPLETED', 'RUNNING'), false);
});

test('COMPLETED → PENDING is invalid (terminal state)', () => {
  assertEqual(canSimTransition('COMPLETED', 'PENDING'), false);
});

test('COMPLETED → FAILED is invalid (terminal state)', () => {
  assertEqual(canSimTransition('COMPLETED', 'FAILED'), false);
});

test('CANCELLED → RUNNING is invalid (terminal state)', () => {
  assertEqual(canSimTransition('CANCELLED', 'RUNNING'), false);
});

test('FAILED → PENDING is valid (retry mechanism)', () => {
  assertEqual(canSimTransition('FAILED', 'PENDING'), true);
});

test('FAILED → RUNNING is invalid (must go through PENDING first)', () => {
  assertEqual(canSimTransition('FAILED', 'RUNNING'), false);
});

test('No transitions from terminal sim states', () => {
  const allStates: SimulationState[] = ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'];
  for (const terminal of TERMINAL_SIM_STATES) {
    for (const target of allStates) {
      assertEqual(canSimTransition(terminal, target), false,
        `Expected no transition from terminal state ${terminal} to ${target}`);
    }
  }
});

test('isTerminalSimState identifies terminal states correctly', () => {
  assertEqual(isTerminalSimState('COMPLETED'), true);
  assertEqual(isTerminalSimState('CANCELLED'), true);
  assertEqual(isTerminalSimState('PENDING'), false);
  assertEqual(isTerminalSimState('RUNNING'), false);
  assertEqual(isTerminalSimState('FAILED'), false);
});

// ---------------------------------------------------------------------------
// Job State Machine Tests
// ---------------------------------------------------------------------------

test('QUEUED → RUNNING is valid', () => {
  assertEqual(canJobTransition('QUEUED', 'RUNNING'), true);
});

test('QUEUED → CANCELLED is valid', () => {
  assertEqual(canJobTransition('QUEUED', 'CANCELLED'), true);
});

test('QUEUED → FAILED is valid', () => {
  assertEqual(canJobTransition('QUEUED', 'FAILED'), true);
});

test('QUEUED → COMPLETED is invalid (must go through RUNNING)', () => {
  assertEqual(canJobTransition('QUEUED', 'COMPLETED'), false);
});

test('RUNNING → COMPLETED is valid', () => {
  assertEqual(canJobTransition('RUNNING', 'COMPLETED'), true);
});

test('RUNNING → FAILED is valid', () => {
  assertEqual(canJobTransition('RUNNING', 'FAILED'), true);
});

test('RUNNING → CANCELLED is valid', () => {
  assertEqual(canJobTransition('RUNNING', 'CANCELLED'), true);
});

test('RUNNING → QUEUED is invalid (no backwards transition)', () => {
  assertEqual(canJobTransition('RUNNING', 'QUEUED'), false);
});

test('COMPLETED → RUNNING is invalid (terminal state)', () => {
  assertEqual(canJobTransition('COMPLETED', 'RUNNING'), false);
});

test('FAILED → QUEUED is valid (retry mechanism)', () => {
  assertEqual(canJobTransition('FAILED', 'QUEUED'), true);
});

test('FAILED → RUNNING is invalid (must go through QUEUED first)', () => {
  assertEqual(canJobTransition('FAILED', 'RUNNING'), false);
});

test('FAILED → CANCELLED is valid (cancel permanently instead of retry)', () => {
  assertEqual(canJobTransition('FAILED', 'CANCELLED'), true);
});

test('No transitions from terminal job states', () => {
  const allStatuses: JobStatus[] = ['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'];
  for (const terminal of TERMINAL_JOB_STATES) {
    for (const target of allStatuses) {
      assertEqual(canJobTransition(terminal, target), false,
        `Expected no transition from terminal state ${terminal} to ${target}`);
    }
  }
});

test('isTerminalJobState identifies terminal states correctly', () => {
  assertEqual(isTerminalJobState('COMPLETED'), true);
  assertEqual(isTerminalJobState('CANCELLED'), true);
  assertEqual(isTerminalJobState('FAILED'), false);  // FAILED allows retry (FAILED → QUEUED)
  assertEqual(isTerminalJobState('QUEUED'), false);
  assertEqual(isTerminalJobState('RUNNING'), false);
});

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

const passed = results.filter((r) => r.passed).length;
const failed = results.filter((r) => !r.passed).length;

console.log(`\n${'─'.repeat(60)}`);
console.log(`State Machine Tests: ${passed} passed, ${failed} failed`);
console.log(`${'─'.repeat(60)}\n`);

for (const r of results) {
  console.log(`  ${r.passed ? '✓' : '✗'} ${r.name}`);
  if (!r.passed) console.log(`    → ${r.error}`);
}

if (failed > 0) {
  console.log(`\n${failed} test(s) failed!\n`);
  process.exit(1);
}

console.log('\nAll state machine tests passed!\n');
