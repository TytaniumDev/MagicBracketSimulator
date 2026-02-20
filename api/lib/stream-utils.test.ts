/**
 * Tests for jobToStreamEvent (SSE event shape).
 *
 * Pure function tests — no I/O, no SQLite, no temp dirs.
 *
 * Run with: npx tsx lib/stream-utils.test.ts
 */

import { jobToStreamEvent, type QueueInfo } from './stream-utils';
import type { Job } from './types';

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

function assertDeepEqual<T>(actual: T, expected: T, message: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    throw new Error(`${message}: expected ${b}, got ${a}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJob(overrides?: Partial<Job>): Job {
  return {
    id: 'job-001',
    decks: [
      { name: 'Deck A', dck: 'a' },
      { name: 'Deck B', dck: 'b' },
      { name: 'Deck C', dck: 'c' },
      { name: 'Deck D', dck: 'd' },
    ],
    status: 'QUEUED',
    simulations: 8,
    createdAt: new Date('2025-01-15T10:00:00Z'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function runTests() {
  console.log('Running stream-utils tests...\n');

  // =========================================================================
  // Field mapping
  // =========================================================================

  await test('id is mapped from job.id', () => {
    const event = jobToStreamEvent(makeJob({ id: 'test-123' }));
    assertEqual(event.id, 'test-123', 'id');
  });

  await test('name is deck names joined with " vs "', () => {
    const event = jobToStreamEvent(makeJob());
    assertEqual(event.name, 'Deck A vs Deck B vs Deck C vs Deck D', 'name');
  });

  await test('deckNames is array of deck names', () => {
    const event = jobToStreamEvent(makeJob());
    assertDeepEqual(event.deckNames, ['Deck A', 'Deck B', 'Deck C', 'Deck D'], 'deckNames');
  });

  await test('status is mapped from job.status', () => {
    const event = jobToStreamEvent(makeJob({ status: 'RUNNING' }));
    assertEqual(event.status, 'RUNNING', 'status');
  });

  await test('simulations is mapped from job.simulations', () => {
    const event = jobToStreamEvent(makeJob({ simulations: 12 }));
    assertEqual(event.simulations, 12, 'simulations');
  });

  await test('parallelism defaults to 4 when unset', () => {
    const event = jobToStreamEvent(makeJob());
    assertEqual(event.parallelism, 4, 'parallelism default');
  });

  await test('parallelism uses job value when set', () => {
    const event = jobToStreamEvent(makeJob({ parallelism: 8 }));
    assertEqual(event.parallelism, 8, 'parallelism');
  });

  await test('createdAt is ISO string', () => {
    const event = jobToStreamEvent(makeJob({ createdAt: new Date('2025-06-01T12:00:00Z') }));
    assertEqual(event.createdAt, '2025-06-01T12:00:00.000Z', 'createdAt');
  });

  await test('retryCount defaults to 0 when unset', () => {
    const event = jobToStreamEvent(makeJob());
    assertEqual(event.retryCount, 0, 'retryCount default');
  });

  await test('retryCount uses job value when set', () => {
    const event = jobToStreamEvent(makeJob({ retryCount: 3 }));
    assertEqual(event.retryCount, 3, 'retryCount');
  });

  await test('workerId is mapped from job', () => {
    const event = jobToStreamEvent(makeJob({ workerId: 'w-1' }));
    assertEqual(event.workerId, 'w-1', 'workerId');
  });

  await test('workerName is mapped from job', () => {
    const event = jobToStreamEvent(makeJob({ workerName: 'Worker Alpha' }));
    assertEqual(event.workerName, 'Worker Alpha', 'workerName');
  });

  await test('errorMessage is mapped from job', () => {
    const event = jobToStreamEvent(makeJob({ errorMessage: 'Something broke' }));
    assertEqual(event.errorMessage, 'Something broke', 'errorMessage');
  });

  await test('startedAt is ISO string when present', () => {
    const event = jobToStreamEvent(makeJob({ startedAt: new Date('2025-01-15T10:05:00Z') }));
    assertEqual(event.startedAt, '2025-01-15T10:05:00.000Z', 'startedAt');
  });

  await test('completedAt is ISO string when present', () => {
    const event = jobToStreamEvent(makeJob({ completedAt: new Date('2025-01-15T10:10:00Z') }));
    assertEqual(event.completedAt, '2025-01-15T10:10:00.000Z', 'completedAt');
  });

  await test('claimedAt is ISO string when present', () => {
    const event = jobToStreamEvent(makeJob({ claimedAt: new Date('2025-01-15T10:04:00Z') }));
    assertEqual(event.claimedAt, '2025-01-15T10:04:00.000Z', 'claimedAt');
  });

  // =========================================================================
  // durationMs computation
  // =========================================================================

  await test('durationMs is null when no completedAt', () => {
    const event = jobToStreamEvent(makeJob({ startedAt: new Date('2025-01-15T10:05:00Z') }));
    assertEqual(event.durationMs, null, 'durationMs');
  });

  await test('durationMs computed from startedAt to completedAt', () => {
    const event = jobToStreamEvent(makeJob({
      startedAt: new Date('2025-01-15T10:00:00Z'),
      completedAt: new Date('2025-01-15T10:05:00Z'),
    }));
    assertEqual(event.durationMs, 5 * 60 * 1000, 'durationMs');
  });

  await test('durationMs falls back to createdAt when no startedAt', () => {
    const event = jobToStreamEvent(makeJob({
      createdAt: new Date('2025-01-15T10:00:00Z'),
      completedAt: new Date('2025-01-15T10:03:00Z'),
    }));
    assertEqual(event.durationMs, 3 * 60 * 1000, 'durationMs fallback');
  });

  // =========================================================================
  // gamesCompleted
  // =========================================================================

  await test('gamesCompleted uses computedGamesCompleted when provided', () => {
    const event = jobToStreamEvent(makeJob({ gamesCompleted: 10 }), undefined, undefined, 20);
    assertEqual(event.gamesCompleted, 20, 'gamesCompleted computed');
  });

  await test('gamesCompleted falls back to job.gamesCompleted', () => {
    const event = jobToStreamEvent(makeJob({ gamesCompleted: 16 }));
    assertEqual(event.gamesCompleted, 16, 'gamesCompleted fallback');
  });

  await test('gamesCompleted defaults to 0 when both unset', () => {
    const event = jobToStreamEvent(makeJob());
    assertEqual(event.gamesCompleted, 0, 'gamesCompleted default');
  });

  // =========================================================================
  // Conditional fields
  // =========================================================================

  await test('queuePosition present only when queueInfo provided', () => {
    const qi: QueueInfo = { queuePosition: 2, workers: { online: 3, idle: 1, busy: 2, updating: 0 } };
    const event = jobToStreamEvent(makeJob(), qi);
    assertEqual(event.queuePosition, 2, 'queuePosition');
    assertDeepEqual(event.workers, { online: 3, idle: 1, busy: 2, updating: 0 }, 'workers');
  });

  await test('queuePosition and workers absent when queueInfo omitted', () => {
    const event = jobToStreamEvent(makeJob());
    assert(!('queuePosition' in event), 'queuePosition should be absent');
    assert(!('workers' in event), 'workers should be absent');
  });

  await test('deckLinks present only when provided', () => {
    const links = { 'Deck A': 'https://example.com/a', 'Deck B': null };
    const event = jobToStreamEvent(makeJob(), undefined, links);
    assertDeepEqual(event.deckLinks, links, 'deckLinks');
  });

  await test('deckLinks absent when omitted', () => {
    const event = jobToStreamEvent(makeJob());
    assert(!('deckLinks' in event), 'deckLinks should be absent');
  });

  await test('dockerRunDurationsMs is passed through from job', () => {
    const event = jobToStreamEvent(makeJob({ dockerRunDurationsMs: [1000, 2000, 3000] }));
    assertDeepEqual(event.dockerRunDurationsMs, [1000, 2000, 3000], 'dockerRunDurationsMs');
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
