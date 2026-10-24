/**
 * Pod run store contract tests.
 *
 * Exercises the factory (not the concrete stores) so the SQLite and Firestore
 * implementations are held to the same shapes. Runs against SQLite by default.
 * To test Firestore parity, run with:
 *   GOOGLE_CLOUD_PROJECT=demo-test FIRESTORE_EMULATOR_HOST=localhost:8080 npx tsx test/pod-run-store.test.ts
 *
 * Run with: npx tsx test/pod-run-store.test.ts
 */

import { getPodRunStore } from '../lib/pod-run-store-factory';
import { podRunToSummary } from '../lib/pod-run-utils';

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

// Unique per run so repeated runs against the same database don't collide.
const runTag = `pod-run-test-${Date.now()}`;
const jobIds = [`${runTag}-job-a`, `${runTag}-job-b`, `${runTag}-job-c`];

async function runTests() {
  console.log('Running pod run store tests...\n');
  const store = await getPodRunStore();
  let createdId = '';

  await test('createPodRun returns the saved run', async () => {
    const run = await store.createPodRun({
      deckIds: ['d1', 'd2', 'd3', 'd4', 'd5'],
      deckNames: ['A', 'B', 'C', 'D', 'E'],
      jobIds,
      simulations: 8,
      createdBy: 'tester',
      idempotencyKey: `${runTag}-key`,
    });
    createdId = run.id;
    assert(run.id.length > 0, 'id should be non-empty');
    assert(run.createdAt instanceof Date, 'createdAt should be a Date');
    assertEqual(run.jobIds.length, 3, 'jobIds length');
  });

  await test('createPodRun with a used idempotency key returns the same run', async () => {
    const again = await store.createPodRun({
      deckIds: ['d1', 'd2', 'd3', 'd4', 'd5'],
      deckNames: ['A', 'B', 'C', 'D', 'E'],
      jobIds,
      simulations: 8,
      createdBy: 'tester',
      idempotencyKey: `${runTag}-key`,
    });
    assertEqual(again.id, createdId, 'id');
  });

  await test('getPodRun keeps deck and job order', async () => {
    const run = await store.getPodRun(createdId);
    assert(run !== null, 'run should exist');
    assertEqual(run!.deckNames.join(','), 'A,B,C,D,E', 'deckNames');
    assertEqual(run!.jobIds.join(','), jobIds.join(','), 'jobIds');
    assertEqual(run!.simulations, 8, 'simulations');
  });

  await test('getPodRun returns null for an unknown id', async () => {
    assertEqual(await store.getPodRun(`${runTag}-missing`), null, 'run');
  });

  await test('listPodRunsForJob finds the run from any of its jobs', async () => {
    const runs = await store.listPodRunsForJob(jobIds[1]);
    assertEqual(runs.length, 1, 'runs length');
    assertEqual(runs[0].id, createdId, 'id');
  });

  await test('listPodRunsForJob returns nothing for a job outside any run', async () => {
    assertEqual((await store.listPodRunsForJob(`${runTag}-other-job`)).length, 0, 'runs length');
  });

  await test('listPodRuns lists the newest run first', async () => {
    const newer = await store.createPodRun({
      deckIds: ['d1', 'd2', 'd3', 'd4', 'd5'],
      deckNames: ['A', 'B', 'C', 'D', 'E'],
      jobIds: [`${runTag}-job-z`],
      simulations: 4,
      createdBy: 'tester',
    });
    const runs = await store.listPodRuns(2);
    assertEqual(runs[0].id, newer.id, 'first run');
    assert(runs.length <= 2, 'limit should be respected');
  });

  await test('podRunToSummary counts pods from job ids', async () => {
    const run = await store.getPodRun(createdId);
    const summary = podRunToSummary(run!);
    assertEqual(summary.podCount, 3, 'podCount');
    assertEqual(typeof summary.createdAt, 'string', 'createdAt type');
  });

  console.log('\n--- Test Summary ---');
  const failed = results.filter((r) => !r.passed);
  console.log(`Passed: ${results.length - failed.length}/${results.length}`);
  if (failed.length > 0) {
    failed.forEach((r) => console.log(`  - ${r.name}: ${r.error}`));
    process.exit(1);
  }
  console.log('\nAll tests passed!');
}

runTests().catch((error) => {
  console.error('Test runner error:', error);
  process.exit(1);
});
