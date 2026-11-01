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
import { podRunToResponse, podRunToSummary } from '../lib/pod-run-utils';
import { createJob, setJobResults } from '../lib/job-store-factory';
import type { JobResults } from '../lib/types';

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

  // --- Standings ---------------------------------------------------------

  const seat = (id: string) => ({ deckId: id, name: id.toUpperCase(), link: null, colorIdentity: [] });
  const podJob = async (ids: string[]) => (await createJob(ids.map(seat), 4)).id;
  /** Results for a pod of `ids`, with wins and average win turns by deck name. */
  const podResults = (ids: string[], wins: Record<string, number>, avgWinTurn: Record<string, number> = {}): JobResults => ({
    gamesPlayed: 4,
    seats: ids.map((id) => ({ wins: wins[seat(id).name] ?? 0, avgWinTurn: avgWinTurn[seat(id).name] ?? null })),
  });

  let standingsRunId = '';
  let finishedJob = '';
  let laterJob = '';

  await test('createPodRun totals the jobs that already have results', async () => {
    finishedJob = await podJob(['d1', 'd2', 'd3', 'd4']);
    laterJob = await podJob(['d1', 'd2', 'd3', 'd5']);
    await setJobResults(finishedJob, podResults(['d1', 'd2', 'd3', 'd4'], { D1: 3, D2: 1 }, { D1: 6, D2: 9 }));

    const run = await store.createPodRun({
      deckIds: ['d1', 'd2', 'd3', 'd4', 'd5'],
      deckNames: ['D1', 'D2', 'D3', 'D4', 'D5'],
      jobIds: [finishedJob, laterJob],
      simulations: 4,
      createdBy: 'tester',
    });
    standingsRunId = run.id;

    assertEqual(run.podsWithResults, 1, 'podsWithResults');
    assertEqual(run.standings.d1.wins, 3, 'd1 wins');
    assertEqual(run.standings.d1.winTurnSum, 18, 'd1 winTurnSum');
    assertEqual(run.standings.d4.gamesPlayed, 4, 'd4 games');
    assertEqual(run.standings.d5, undefined, 'd5 has no finished pod yet');
  });

  await test('applyJob adds a job once its results are in, and only once', async () => {
    assertEqual(await store.applyJob(laterJob), false, 'no results yet');
    await setJobResults(laterJob, podResults(['d1', 'd2', 'd3', 'd5'], { D5: 4 }, { D5: 5 }));

    assertEqual(await store.applyJob(laterJob), true, 'first apply');
    assertEqual(await store.applyJob(laterJob), false, 'second apply');
    assertEqual(await store.applyJob(finishedJob), false, 'already totalled at save');

    const run = await store.getPodRun(standingsRunId);
    assertEqual(run!.podsWithResults, 2, 'podsWithResults');
    assertEqual(run!.standings.d1.pods, 2, 'd1 pods');
    assertEqual(run!.standings.d1.gamesPlayed, 8, 'd1 games');
    assertEqual(run!.standings.d5.wins, 4, 'd5 wins');
  });

  await test('a job stays in the first run it was saved in', async () => {
    const other = await store.createPodRun({
      deckIds: ['d1', 'd2', 'd3', 'd4', 'd5'],
      deckNames: ['D1', 'D2', 'D3', 'D4', 'D5'],
      jobIds: [finishedJob],
      simulations: 4,
      createdBy: 'tester',
    });
    assertEqual(other.podsWithResults, 0, 'podsWithResults');
  });

  await test('applyJob ignores a job in no run', async () => {
    const loose = await podJob(['d1', 'd2', 'd3', 'd4']);
    await setJobResults(loose, podResults(['d1', 'd2', 'd3', 'd4'], { D1: 4 }));
    assertEqual(await store.applyJob(loose), false, 'applied');
  });

  await test('podRunToResponse ranks the standings by win rate', async () => {
    const response = podRunToResponse((await store.getPodRun(standingsRunId))!);
    assertEqual(response.standings.map((s) => s.key).join(','), 'd5,d1,d2,d3,d4', 'order');
    assertEqual(response.standings[1].winRate, 3 / 8, 'd1 win rate');
    assertEqual(response.standings[1].avgWinTurn, 6, 'd1 avg win turn');
    assertEqual(response.standings[3].avgWinTurn, null, 'd3 avg win turn');
    assertEqual(response.podsWithResults, 2, 'podsWithResults');
  });

  await test('removeJob takes a job and its results out of its run', async () => {
    assertEqual(await store.removeJob(laterJob), true, 'removed');
    const run = await store.getPodRun(standingsRunId);
    assertEqual(run!.jobIds.join(','), finishedJob, 'job ids');
    assertEqual(run!.podsWithResults, 1, 'podsWithResults');
    assertEqual(run!.standings.d1.pods, 1, 'd1 pods');
    assertEqual(run!.standings.d1.gamesPlayed, 4, 'd1 games');
    assertEqual(run!.standings.d5, undefined, 'd5 played no other pod');
    assertEqual(await store.removeJob(laterJob), false, 'second remove');
  });

  await test('removeJob deletes every run it leaves empty', async () => {
    const runIds = (await store.listPodRunsForJob(finishedJob)).map((r) => r.id);
    assertEqual(runIds.length, 2, 'in two runs');
    assertEqual(await store.removeJob(finishedJob), true, 'removed');
    for (const id of runIds) assertEqual(await store.getPodRun(id), null, `run ${id}`);
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
