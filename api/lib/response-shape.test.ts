/**
 * Response shape tests — assert the exact JSON shape of API responses.
 *
 * These are "golden file" tests: any field addition, removal, or rename
 * fails the test, catching silent frontend breakage at compile+test time.
 *
 * Run with: npx tsx lib/response-shape.test.ts
 */

import { jobToStreamEvent, type QueueInfo } from './stream-utils';
import type { Job, JobResults } from './types';
import type { JobResponse, JobSummary } from '@shared/types/job';

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

function assertHasExactKeys(obj: Record<string, unknown>, expectedKeys: string[], message: string) {
  const actual = Object.keys(obj).sort();
  const expected = expectedKeys.sort();
  const missing = expected.filter((k) => !actual.includes(k));
  const extra = actual.filter((k) => !expected.includes(k));
  if (missing.length > 0 || extra.length > 0) {
    const parts: string[] = [];
    if (missing.length > 0) parts.push(`missing: [${missing.join(', ')}]`);
    if (extra.length > 0) parts.push(`extra: [${extra.join(', ')}]`);
    throw new Error(`${message}: ${parts.join('; ')}`);
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
  console.log('Running response shape tests...\n');

  // =========================================================================
  // jobToStreamEvent shape for QUEUED jobs
  // =========================================================================

  await test('QUEUED job has exactly the expected base fields', () => {
    const event = jobToStreamEvent(makeJob({ status: 'QUEUED' }));
    assertHasExactKeys(event as unknown as Record<string, unknown>, [
      'id', 'name', 'deckNames', 'status', 'simulations', 'gamesCompleted',
      'parallelism', 'createdAt', 'errorMessage', 'startedAt', 'completedAt',
      'durationMs', 'dockerRunDurationsMs', 'workerId', 'workerName',
      'claimedAt', 'retryCount', 'results',
    ], 'QUEUED job fields');
  });

  await test('QUEUED job with queueInfo adds queuePosition and workers', () => {
    const qi: QueueInfo = { queuePosition: 2, workers: { online: 3, idle: 1, busy: 2, updating: 0 } };
    const event = jobToStreamEvent(makeJob({ status: 'QUEUED' }), qi);
    assertHasExactKeys(event as unknown as Record<string, unknown>, [
      'id', 'name', 'deckNames', 'status', 'simulations', 'gamesCompleted',
      'parallelism', 'createdAt', 'errorMessage', 'startedAt', 'completedAt',
      'durationMs', 'dockerRunDurationsMs', 'workerId', 'workerName',
      'claimedAt', 'retryCount', 'results',
      'queuePosition', 'workers',
    ], 'QUEUED job with queueInfo');
  });

  // =========================================================================
  // jobToStreamEvent shape for COMPLETED jobs
  // =========================================================================

  await test('COMPLETED job has expected fields', () => {
    const completedJob = makeJob({
      status: 'COMPLETED',
      startedAt: new Date('2025-01-15T10:05:00Z'),
      completedAt: new Date('2025-01-15T10:10:00Z'),
      results: { wins: { 'Deck A': 5 }, avgWinTurn: { 'Deck A': 8 }, gamesPlayed: 8 },
    });
    const event = jobToStreamEvent(completedJob);
    assertHasExactKeys(event as unknown as Record<string, unknown>, [
      'id', 'name', 'deckNames', 'status', 'simulations', 'gamesCompleted',
      'parallelism', 'createdAt', 'errorMessage', 'startedAt', 'completedAt',
      'durationMs', 'dockerRunDurationsMs', 'workerId', 'workerName',
      'claimedAt', 'retryCount', 'results',
    ], 'COMPLETED job fields');
  });

  await test('COMPLETED job with deckLinks adds deckLinks field', () => {
    const completedJob = makeJob({ status: 'COMPLETED' });
    const deckLinks = { 'Deck A': 'https://moxfield.com/decks/a', 'Deck B': null };
    const event = jobToStreamEvent(completedJob, undefined, deckLinks);
    assert('deckLinks' in event, 'deckLinks should be present');
    assertHasExactKeys(event as unknown as Record<string, unknown>, [
      'id', 'name', 'deckNames', 'status', 'simulations', 'gamesCompleted',
      'parallelism', 'createdAt', 'errorMessage', 'startedAt', 'completedAt',
      'durationMs', 'dockerRunDurationsMs', 'workerId', 'workerName',
      'claimedAt', 'retryCount', 'results', 'deckLinks',
    ], 'COMPLETED job with deckLinks');
  });

  // =========================================================================
  // jobToStreamEvent shape with deckIds
  // =========================================================================

  await test('Job with deckIds includes deckIds in stream event', () => {
    const jobWithDeckIds = makeJob({
      status: 'COMPLETED',
      deckIds: ['deck-a', 'deck-b', 'deck-c', 'deck-d'],
    });
    const event = jobToStreamEvent(jobWithDeckIds);
    assert('deckIds' in event, 'deckIds should be present');
    assertHasExactKeys(event as unknown as Record<string, unknown>, [
      'id', 'name', 'deckNames', 'deckIds', 'status', 'simulations', 'gamesCompleted',
      'parallelism', 'createdAt', 'errorMessage', 'startedAt', 'completedAt',
      'durationMs', 'dockerRunDurationsMs', 'workerId', 'workerName',
      'claimedAt', 'retryCount', 'results',
    ], 'Job with deckIds');
    const ids = (event as unknown as Record<string, unknown>).deckIds as string[];
    assert(Array.isArray(ids) && ids.length === 4, 'deckIds should be array of 4');
  });

  await test('Job without deckIds does not include deckIds field', () => {
    const jobNoDeckIds = makeJob({ status: 'COMPLETED' });
    const event = jobToStreamEvent(jobNoDeckIds);
    assert(!('deckIds' in event), 'deckIds should NOT be present');
  });

  await test('Job with fewer than 4 deckIds does not include deckIds field', () => {
    const jobPartial = makeJob({
      status: 'COMPLETED',
      deckIds: ['deck-a', 'deck-b'],
    });
    const event = jobToStreamEvent(jobPartial);
    assert(!('deckIds' in event), 'deckIds should NOT be present for partial deckIds');
  });

  // =========================================================================
  // Type compatibility checks (compile-time, verified at runtime)
  // =========================================================================

  await test('jobToStreamEvent return satisfies JobResponse type', () => {
    const event = jobToStreamEvent(makeJob());
    // These assignments verify the return type is compatible with JobResponse
    const _response: JobResponse = event;
    assert(_response.id === 'job-001', 'id should match');
    assert(Array.isArray(_response.deckNames), 'deckNames should be array');
    assert(typeof _response.gamesCompleted === 'number', 'gamesCompleted should be number');
    assert(typeof _response.parallelism === 'number', 'parallelism should be number');
    assert(typeof _response.retryCount === 'number', 'retryCount should be number');
  });

  await test('JobResults shape matches expected structure', () => {
    const results: JobResults = {
      wins: { 'Deck A': 5, 'Deck B': 3 },
      avgWinTurn: { 'Deck A': 8, 'Deck B': 12 },
      gamesPlayed: 8,
    };
    assertHasExactKeys(results as unknown as Record<string, unknown>, [
      'wins', 'avgWinTurn', 'gamesPlayed',
    ], 'JobResults fields');
  });

  // =========================================================================
  // Field type assertions
  // =========================================================================

  await test('date fields are ISO strings, not Date objects', () => {
    const event = jobToStreamEvent(makeJob({
      startedAt: new Date('2025-01-15T10:05:00Z'),
      completedAt: new Date('2025-01-15T10:10:00Z'),
      claimedAt: new Date('2025-01-15T10:04:00Z'),
    }));
    assert(typeof event.createdAt === 'string', 'createdAt should be string');
    assert(typeof event.startedAt === 'string', 'startedAt should be string');
    assert(typeof event.completedAt === 'string', 'completedAt should be string');
    assert(typeof event.claimedAt === 'string', 'claimedAt should be string');
    // Verify they're valid ISO strings
    assert(!isNaN(Date.parse(event.createdAt)), 'createdAt should be valid ISO');
    assert(!isNaN(Date.parse(event.startedAt!)), 'startedAt should be valid ISO');
  });

  await test('numeric fields have correct types', () => {
    const event = jobToStreamEvent(makeJob({
      status: 'COMPLETED',
      startedAt: new Date('2025-01-15T10:05:00Z'),
      completedAt: new Date('2025-01-15T10:10:00Z'),
    }));
    assert(typeof event.gamesCompleted === 'number', 'gamesCompleted');
    assert(typeof event.parallelism === 'number', 'parallelism');
    assert(typeof event.retryCount === 'number', 'retryCount');
    assert(typeof event.durationMs === 'number', 'durationMs should be number when both dates set');
    assert(typeof event.simulations === 'number', 'simulations');
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
