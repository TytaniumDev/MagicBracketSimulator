/**
 * Deleting a job takes it back out of every stat it fed (SQLite).
 *
 * Aggregates two jobs of the same pod from a real Forge log, saves them as
 * a pod run, then deletes them one at a time: after the first delete each
 * stat must equal what one job alone gave, and after the second the decks
 * have no stats and the run is gone. Runs in a temp directory so it never
 * touches the local dev database.
 *
 * Run with: npx tsx test/job-delete.test.ts
 */

import { testSeats } from './seats';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'job-delete-test-'));
const logsDir = path.join(tmpDir, 'logs-data');
process.env.LOGS_DATA_DIR = logsDir;
delete process.env.GOOGLE_CLOUD_PROJECT;
const fixturePath = path.join(__dirname, '..', 'lib', 'condenser', 'fixtures', 'real-4game-log.txt');
process.chdir(tmpDir);

let failed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    failed++;
    console.log(`✗ ${name}\n  Error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}: expected ${e}, got ${a}`);
}

/** Aggregation updates stats without waiting; poll until it has. */
async function waitFor(what: string, done: () => Promise<boolean>) {
  for (let i = 0; i < 100; i++) {
    if (await done()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function main() {
  // Imported after the env and cwd are set, since modules read them on load.
  const jobStore = await import('../lib/job-store-factory');
  const { getRatingStore } = await import('../lib/rating-store-factory');
  const { getCardStatsStore } = await import('../lib/card-stats-store-factory');
  const { getPodRunStore } = await import('../lib/pod-run-store-factory');
  const { uploadSingleSimulationLog } = await import('../lib/log-store');
  const { deleteJobCompletely } = await import('../lib/job-delete');

  const seats = testSeats(['Doran Big Butts', 'Enduring Enchantments', 'Explorers of the Deep', 'Veloci-RAMP-Tor']);
  const deckIds = seats.map((s) => s.deckId);
  const log = fs.readFileSync(fixturePath, 'utf-8');
  const ratings = getRatingStore();
  const cardStats = getCardStatsStore();
  const podRuns = await getPodRunStore();

  /** A finished job with the fixture's 4 games, its stats counted. */
  async function finishedJob(): Promise<string> {
    const { id } = await jobStore.createJob(seats, 4);
    await jobStore.initializeSimulations(id, 1);
    await jobStore.updateSimulationStatus(id, 'sim_000', { state: 'COMPLETED' });
    await uploadSingleSimulationLog(id, 'raw/game_001.txt', log);
    await jobStore.aggregateJobResults(id);
    await waitFor('stats', async () => (await cardStats.get(deckIds[0]!))?.jobIds.includes(id) ?? false);
    await waitFor('ratings', async () => {
      const pairs = await ratings.getPairGameCounts();
      return [...pairs.values()].some((n) => n > 0);
    });
    return id;
  }

  /** Every stat a job feeds, without ids or times that differ between jobs. */
  async function snapshot(runId: string) {
    const deckRatings = await Promise.all(deckIds.map((id) => ratings.getRating(id)));
    const cards = await Promise.all(deckIds.map((id) => cardStats.get(id)));
    const run = await podRuns.getPodRun(runId);
    return {
      ratings: deckRatings.map((r) => r && { ...r, lastUpdated: undefined }),
      pairs: [...(await ratings.getPairGameCounts())],
      cards: cards.map((c) => c && { ...c, jobIds: c.jobIds.length }),
      standings: run?.standings ?? null,
      podsWithResults: run?.podsWithResults ?? null,
    };
  }

  const job1 = await finishedJob();
  const run = await podRuns.createPodRun({
    deckIds,
    deckNames: seats.map((s) => s.name),
    jobIds: [job1],
    simulations: 4,
    createdBy: 'test',
  });
  const oneJob = await snapshot(run.id);
  // A second run of the same pod: the run's jobs list grows to include it.
  const job2 = await finishedJob();
  await podRuns.removeJob(job1);
  const both = await podRuns.createPodRun({
    deckIds,
    deckNames: seats.map((s) => s.name),
    jobIds: [job1, job2],
    simulations: 4,
    createdBy: 'test',
  });

  await test('both jobs are counted', async () => {
    const r = await ratings.getRating(deckIds[0]!);
    assertEqual(r?.gamesPlayed, 8, 'games played');
    assertEqual((await cardStats.get(deckIds[0]!))?.games, 8, 'card stat games');
    assertEqual((await podRuns.getPodRun(both.id))?.podsWithResults, 2, 'pods with results');
  });

  await test('deleting one job leaves exactly what the other job gave', async () => {
    assertEqual(await deleteJobCompletely(job2), true, 'deleted');
    const after = await snapshot(both.id);
    assertEqual(after, oneJob, 'stats');
    assertEqual((await podRuns.getPodRun(both.id))?.jobIds, [job1], 'run jobs');
  });

  await test('without its receipt, a delete counts the logs again', async () => {
    fs.rmSync(path.join(logsDir, job1, 'card-stats.json'));
    assertEqual(await deleteJobCompletely(job1), true, 'deleted');
    for (const id of deckIds) {
      assertEqual(await ratings.getRating(id), null, `${id} rating`);
      const cards = await cardStats.get(id);
      assertEqual([cards?.games, cards?.wins, Object.keys(cards?.cards ?? {}).length, cards?.jobIds], [0, 0, 0, []], `${id} cards`);
    }
    assertEqual([...(await ratings.getPairGameCounts())], [], 'pair counts');
  });

  await test('a run left with no jobs is deleted', async () => {
    assertEqual(await podRuns.getPodRun(both.id), null, 'run');
  });

  await test('deleting a job twice is a no-op', async () => {
    assertEqual(await deleteJobCompletely(job1), false, 'second delete');
  });

  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log(failed > 0 ? `\n${failed} test(s) failed` : '\nAll tests passed!');
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error('Test runner error:', error);
  process.exit(1);
});
