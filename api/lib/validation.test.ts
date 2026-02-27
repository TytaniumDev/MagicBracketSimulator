/**
 * Tests for Zod request validation schemas.
 * Run with: npx tsx lib/validation.test.ts
 */

import { createJobSchema, updateSimulationSchema, updateJobSchema, parseBody } from './validation';

interface TestResult { name: string; passed: boolean; error?: string; }
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

async function runTests() {
  console.log('Running validation tests...\n');

  // ── createJobSchema ──────────────────────────────────────────────────

  await test('createJobSchema: valid input passes', () => {
    const result = parseBody(createJobSchema, {
      deckIds: ['a', 'b', 'c', 'd'],
      simulations: 8,
    });
    assertEqual(result.success, true, 'should succeed');
  });

  await test('createJobSchema: with optional fields', () => {
    const result = parseBody(createJobSchema, {
      deckIds: ['a', 'b', 'c', 'd'],
      simulations: 8,
      parallelism: 4,
      idempotencyKey: 'key-123',
    });
    assertEqual(result.success, true, 'should succeed');
    if (result.success) {
      assertEqual(result.data.parallelism, 4, 'parallelism');
      assertEqual(result.data.idempotencyKey, 'key-123', 'idempotencyKey');
    }
  });

  await test('createJobSchema: rejects wrong deckIds count', () => {
    const result = parseBody(createJobSchema, {
      deckIds: ['a', 'b', 'c'],
      simulations: 8,
    });
    assertEqual(result.success, false, 'should fail');
    if (!result.success) assertEqual(result.error, 'deckIds: Exactly 4 deckIds are required', 'error message');
  });

  await test('createJobSchema: rejects empty deckIds', () => {
    const result = parseBody(createJobSchema, {
      deckIds: ['a', '', 'c', 'd'],
      simulations: 8,
    });
    assertEqual(result.success, false, 'should fail');
  });

  await test('createJobSchema: rejects simulations below minimum', () => {
    const result = parseBody(createJobSchema, {
      deckIds: ['a', 'b', 'c', 'd'],
      simulations: 1,
    });
    assertEqual(result.success, false, 'should fail');
  });

  await test('createJobSchema: rejects simulations above maximum', () => {
    const result = parseBody(createJobSchema, {
      deckIds: ['a', 'b', 'c', 'd'],
      simulations: 200,
    });
    assertEqual(result.success, false, 'should fail');
  });

  await test('createJobSchema: rejects non-number simulations', () => {
    const result = parseBody(createJobSchema, {
      deckIds: ['a', 'b', 'c', 'd'],
      simulations: 'eight',
    });
    assertEqual(result.success, false, 'should fail');
  });

  await test('createJobSchema: rejects missing deckIds', () => {
    const result = parseBody(createJobSchema, {
      simulations: 8,
    });
    assertEqual(result.success, false, 'should fail');
  });

  await test('createJobSchema: rejects parallelism out of range', () => {
    const result = parseBody(createJobSchema, {
      deckIds: ['a', 'b', 'c', 'd'],
      simulations: 8,
      parallelism: 100,
    });
    assertEqual(result.success, false, 'should fail');
  });

  // ── updateSimulationSchema ──────────────────────────────────────────

  await test('updateSimulationSchema: valid RUNNING state', () => {
    const result = parseBody(updateSimulationSchema, {
      state: 'RUNNING',
      workerId: 'w1',
      workerName: 'Worker 1',
    });
    assertEqual(result.success, true, 'should succeed');
  });

  await test('updateSimulationSchema: valid COMPLETED with results', () => {
    const result = parseBody(updateSimulationSchema, {
      state: 'COMPLETED',
      durationMs: 5000,
      winners: ['Deck A', 'Deck B'],
      winningTurns: [8, 12],
    });
    assertEqual(result.success, true, 'should succeed');
  });

  await test('updateSimulationSchema: rejects invalid state', () => {
    const result = parseBody(updateSimulationSchema, {
      state: 'INVALID_STATE',
    });
    assertEqual(result.success, false, 'should fail');
  });

  await test('updateSimulationSchema: empty body passes (all optional)', () => {
    const result = parseBody(updateSimulationSchema, {});
    assertEqual(result.success, true, 'should succeed');
  });

  // ── updateJobSchema ─────────────────────────────────────────────────

  await test('updateJobSchema: valid RUNNING status', () => {
    const result = parseBody(updateJobSchema, {
      status: 'RUNNING',
      workerId: 'w1',
      workerName: 'Worker 1',
    });
    assertEqual(result.success, true, 'should succeed');
  });

  await test('updateJobSchema: valid FAILED with error', () => {
    const result = parseBody(updateJobSchema, {
      status: 'FAILED',
      errorMessage: 'Something went wrong',
    });
    assertEqual(result.success, true, 'should succeed');
  });

  await test('updateJobSchema: rejects invalid status', () => {
    const result = parseBody(updateJobSchema, {
      status: 'BOGUS',
    });
    assertEqual(result.success, false, 'should fail');
  });

  await test('updateJobSchema: valid COMPLETED with durations', () => {
    const result = parseBody(updateJobSchema, {
      status: 'COMPLETED',
      dockerRunDurationsMs: [1000, 2000, 3000],
    });
    assertEqual(result.success, true, 'should succeed');
  });

  // ── Summary ─────────────────────────────────────────────────────────

  console.log('\n--- Test Summary ---');
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`Passed: ${passed}/${results.length}`);
  console.log(`Failed: ${failed}/${results.length}`);

  if (failed > 0) {
    console.log('\nFailed tests:');
    results.filter(r => !r.passed).forEach(r => console.log(`  - ${r.name}: ${r.error}`));
    process.exit(1);
  }
  console.log('\nAll tests passed!');
}

runTests().catch(err => { console.error('Test runner error:', err); process.exit(1); });
