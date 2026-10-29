/**
 * Card stats store contract tests.
 *
 * Exercises the factory so SQLite and Firestore are held to the same
 * behavior. Runs against SQLite by default. To test Firestore parity, run with:
 *   GOOGLE_CLOUD_PROJECT=demo-test FIRESTORE_EMULATOR_HOST=localhost:8080 npx tsx test/card-stats-store.test.ts
 *
 * Run with: npx tsx test/card-stats-store.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { getCardStatsStore } from '../lib/card-stats-store-factory';
import { processJobsForCardStats } from '../lib/card-impact/service';
import type { DeckCardStats } from '../lib/card-stats-store';

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
  const store = getCardStatsStore();
  const deckId = `card-stats-test-${Date.now()}`;

  await test('get returns null for a deck with no counted jobs', async () => {
    assertEqual(await store.get(deckId), null, 'no stats');
  });

  const addGames = (jobId: string, games: number) => ({
    jobId,
    update: (stats: DeckCardStats) => ({ ...stats, games: stats.games + games }),
  });

  await test('addJobs applies the update and records the job', async () => {
    const applied = await store.addJobs(deckId, [addGames('job-1', 2)]);
    assertEqual(applied, 1, 'applied');
    const stats = await store.get(deckId);
    assertEqual(stats?.games, 2, 'games');
    assertEqual(stats?.jobIds, ['job-1'], 'job ids');
  });

  await test('addJobs skips a job it already counted', async () => {
    const applied = await store.addJobs(deckId, [addGames('job-1', 2)]);
    assertEqual(applied, 0, 'skipped');
    assertEqual((await store.get(deckId))?.games, 2, 'games unchanged');
  });

  await test('addJobs applies a batch in one call, skipping counted and repeated jobs', async () => {
    const applied = await store.addJobs(deckId, [
      addGames('job-1', 100),
      addGames('job-2', 3),
      addGames('job-3', 4),
      addGames('job-3', 100),
    ]);
    assertEqual(applied, 2, 'applied');
    const stats = await store.get(deckId);
    assertEqual(stats?.games, 9, 'games');
    assertEqual(stats?.jobIds, ['job-1', 'job-2', 'job-3'], 'job ids');
  });

  await test('counters from an older parser version are dropped and rebuilt', async () => {
    const staleDeckId = `${deckId}-stale`;
    await store.addJobs(staleDeckId, [
      { jobId: 'job-old', update: (stats) => ({ ...stats, games: 7, version: 1 }) },
    ]);
    assertEqual(await store.get(staleDeckId), null, 'stale stats hidden');
    await store.addJobs(staleDeckId, [addGames('job-old', 1)]);
    const stats = await store.get(staleDeckId);
    assertEqual(stats?.games, 1, 'rebuilt from scratch');
    assertEqual(stats?.jobIds, ['job-old'], 'the same job can be counted again');
  });

  await test('processJobsForCardStats counts a page of jobs per deck', async () => {
    const log = fs.readFileSync(path.join(__dirname, '..', 'lib', 'card-impact', 'fixtures', 'forge-2.0.15-game.txt'), 'utf-8');
    const deckIds = ['temur', 'doran', 'marchesa', 'cavalry'].map((d) => `${deckId}-${d}`);
    const deckNames = ['Temur Roar Upgraded', 'Doran Big Butts', 'Marchesa', 'Cavalry Charge Upgraded'];
    const job = (jobId: string) => ({ jobId, deckIds, deckNames, rawLogs: [log] });
    await processJobsForCardStats([job('page-1'), job('page-2')]);
    const temur = await store.get(deckIds[0]);
    assertEqual(temur?.games, 2, 'one game per job');
    assertEqual(temur?.wins, 2, 'Temur won both');
    assertEqual(temur?.jobIds, ['page-1', 'page-2'], 'job ids');
  });

  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  console.log(`\nPassed: ${passed}/${results.length}`);
  console.log(`Failed: ${failed}/${results.length}`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error('Test runner error:', error);
  process.exit(1);
});
