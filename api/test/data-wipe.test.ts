/**
 * Admin data wipe tests (SQLite).
 *
 * Seeds jobs with their simulations and logs, a pod run,
 * ratings, match results, card stats and a user deck, then runs the wipe to
 * completion and checks that only the precon is left. Runs in a temp
 * directory so it never touches the local dev database.
 *
 * Run with: npx tsx test/data-wipe.test.ts
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'data-wipe-test-'));
const logsDir = path.join(tmpDir, 'logs-data');
process.env.LOGS_DATA_DIR = logsDir;
process.env.FORGE_ENGINE_PATH = path.join(tmpDir, 'forge-engine');
delete process.env.GOOGLE_CLOUD_PROJECT;
process.chdir(tmpDir);

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

function assertEqual<T>(actual: T, expected: T, message: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}: expected ${e}, got ${a}`);
}

async function main() {
  // Imported after the env and cwd are set, since modules read them on load.
  const jobStore = await import('../lib/job-store-factory');
  const { getDb } = await import('../lib/db');
  const { getPodRunStore } = await import('../lib/pod-run-store-factory');
  const { getRatingStore } = await import('../lib/rating-store-factory');
  const { getCardStatsStore } = await import('../lib/card-stats-store-factory');
  const { saveDeck, listSavedDecks } = await import('../lib/saved-decks');
  const { ingestLogs } = await import('../lib/log-store');
  const { wipeNextStep } = await import('../lib/data-wipe');

  const deck = { name: 'Test Deck', dck: '[Commander]\n1 Sol Ring\n' };
  const decks = [deck, deck, deck, deck];
  const db = getDb();
  const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

  // 12 jobs, so the wipe takes more than one step to clear them.
  const jobIds: string[] = [];
  for (let i = 0; i < 12; i++) {
    const job = await jobStore.createJob(decks, 4, { idempotencyKey: `wipe-test-${i}` });
    await jobStore.initializeSimulations(job.id, 2);
    jobIds.push(job.id);
  }
  await ingestLogs(jobIds[0], ['game log']);
  await (await getPodRunStore()).createPodRun({
    deckIds: ['a', 'b', 'c', 'd'],
    deckNames: ['A', 'B', 'C', 'D'],
    jobIds: jobIds.slice(0, 2),
    simulations: 4,
    createdBy: 'test',
  });
  await getRatingStore().updateRatings([{ deckId: 'a', mu: 25, sigma: 8, gamesPlayed: 1, wins: 1, lastUpdated: new Date().toISOString() }]);
  await getRatingStore().recordMatchResults([{
    id: `${jobIds[0]}_0`, jobId: jobIds[0], gameIndex: 0, deckIds: ['a', 'b', 'c', 'd'],
    winnerDeckId: 'a', turnCount: 7, playedAt: new Date().toISOString(),
  }]);
  await getCardStatsStore().addJobs('a', [{ jobId: jobIds[0], update: (s) => ({ ...s, games: 1 }) }]);
  saveDeck('My Custom Deck', deck.dck);
  db.prepare("INSERT INTO precons (id, name, filename, dck, synced_at) VALUES ('precon-1', 'Precon', 'precon.dck', ?, ?)").run(deck.dck, new Date().toISOString());

  await test('seeded data is present', () => {
    assertEqual(count('jobs'), 12, 'jobs');
    assertEqual(count('simulations'), 24, 'simulations');
    assertEqual(listSavedDecks().length, 1, 'saved decks');
    assertEqual(fs.existsSync(path.join(logsDir, jobIds[0])), true, 'job logs');
  });

  const steps: { kind: string; deleted: number }[] = [];
  await test('wipe runs to completion in bounded steps', async () => {
    for (let i = 0; i < 20; i++) {
      const step = await wipeNextStep();
      if (!step) return;
      steps.push(step);
    }
    throw new Error('wipe did not finish in 20 steps');
  });

  await test('jobs go first, then each leftover kind', () => {
    assertEqual(steps, [
      { kind: 'jobs', deleted: 10 },
      { kind: 'jobs', deleted: 2 },
      { kind: 'podRuns', deleted: 1 },
      { kind: 'matchResults', deleted: 1 },
      { kind: 'ratings', deleted: 1 },
      { kind: 'cardStats', deleted: 1 },
      { kind: 'customDecks', deleted: 1 },
    ], 'steps');
  });

  await test('everything but the precon is gone', () => {
    for (const table of ['jobs', 'simulations', 'pod_runs', 'pod_run_jobs', 'match_results', 'ratings', 'card_stats']) {
      assertEqual(count(table), 0, table);
    }
    assertEqual(listSavedDecks().length, 0, 'saved decks');
    assertEqual(fs.existsSync(path.join(logsDir, jobIds[0])), false, 'job logs');
    assertEqual(count('precons'), 1, 'precons');
  });

  await test('a wipe with nothing left is a no-op', async () => {
    assertEqual(await wipeNextStep(), null, 'step');
  });

  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log('\n--- Test Summary ---');
  const failed = results.filter((r) => !r.passed);
  console.log(`Passed: ${results.length - failed.length}/${results.length}`);
  if (failed.length > 0) {
    failed.forEach((r) => console.log(`  - ${r.name}: ${r.error}`));
    process.exit(1);
  }
  console.log('\nAll tests passed!');
}

main().catch((error) => {
  console.error('Test runner error:', error);
  process.exit(1);
});
