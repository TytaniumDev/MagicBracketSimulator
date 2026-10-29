/**
 * Card stats store contract tests.
 *
 * Exercises the factory so SQLite and Firestore are held to the same
 * behavior. Runs against SQLite by default. To test Firestore parity, run with:
 *   GOOGLE_CLOUD_PROJECT=demo-test FIRESTORE_EMULATOR_HOST=localhost:8080 npx tsx test/card-stats-store.test.ts
 *
 * Run with: npx tsx test/card-stats-store.test.ts
 */

import { getCardStatsStore } from '../lib/card-stats-store-factory';

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

  await test('addJob applies the update and records the job', async () => {
    const applied = await store.addJob(deckId, 'job-1', (stats) => {
      stats.games += 2;
      return stats;
    });
    assertEqual(applied, true, 'applied');
    const stats = await store.get(deckId);
    assertEqual(stats?.games, 2, 'games');
    assertEqual(stats?.jobIds, ['job-1'], 'job ids');
  });

  await test('addJob skips a job it already counted', async () => {
    const applied = await store.addJob(deckId, 'job-1', (stats) => {
      stats.games += 2;
      return stats;
    });
    assertEqual(applied, false, 'skipped');
    assertEqual((await store.get(deckId))?.games, 2, 'games unchanged');
  });

  await test('addJob accumulates across jobs', async () => {
    await store.addJob(deckId, 'job-2', (stats) => {
      stats.games += 3;
      return stats;
    });
    const stats = await store.get(deckId);
    assertEqual(stats?.games, 5, 'games');
    assertEqual(stats?.jobIds, ['job-1', 'job-2'], 'job ids');
  });

  await test('counters from an older parser version are dropped and rebuilt', async () => {
    const staleDeckId = `${deckId}-stale`;
    await store.addJob(staleDeckId, 'job-old', (stats) => ({ ...stats, games: 7, version: 1 }));
    assertEqual(await store.get(staleDeckId), null, 'stale stats hidden');
    await store.addJob(staleDeckId, 'job-old', (stats) => {
      stats.games += 1;
      return stats;
    });
    const stats = await store.get(staleDeckId);
    assertEqual(stats?.games, 1, 'rebuilt from scratch');
    assertEqual(stats?.jobIds, ['job-old'], 'the same job can be counted again');
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
