/**
 * Rating store contract tests: applying a job once, pair game counts and
 * the leaderboard's game floor.
 *
 * Exercises the factory so SQLite and Firestore are held to the same
 * behavior. Runs against SQLite by default. To test Firestore parity, run with:
 *   GOOGLE_CLOUD_PROJECT=demo-test FIRESTORE_EMULATOR_HOST=localhost:8080 npx tsx test/rating-store.test.ts
 *
 * Run with: npx tsx test/rating-store.test.ts
 */
import { testSeats } from './seats';
import { getRatingStore } from '../lib/rating-store-factory';
import { createJob } from '../lib/job-store-factory';
import { addPodPairGames, pairKey, type DeckRating } from '../lib/rating-store';

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

async function main() {
  const store = getRatingStore();
  const run = Date.now();
  const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((x) => `rating-test-${run}-${x}`) as [string, string, string, string];
  const pod = [a, b, c, d];
  const deck = { name: 'Test Deck', dck: '[Commander]\n1 Sol Ring\n' };
  const [job1, job2] = await Promise.all([1, 2].map(async () => (await createJob(testSeats([deck.name, deck.name, deck.name, deck.name]), 4)).id));

  /** Each deck plays `games` more, and the first seat wins them all. */
  const firstSeatWins = (games: number) => (stored: (DeckRating | null)[]) =>
    stored.map((r, i) => ({
      deckId: pod[i]!,
      mu: 25,
      sigma: 25 / 3,
      gamesPlayed: (r?.gamesPlayed ?? 0) + games,
      wins: (r?.wins ?? 0) + (i === 0 ? games : 0),
      lastUpdated: new Date().toISOString(),
    }));

  await test('addPodPairGames counts every other seat, not the deck itself', () => {
    const counts = addPodPairGames(new Map(), ['x', 'y', 'x', 'z'], 2);
    assertEqual(counts.get('x'), { y: 4, z: 4 }, 'x');
    assertEqual(counts.get('y'), { x: 4, z: 2 }, 'y');
  });

  await test('applyJob updates ratings and pair counts', async () => {
    const applied = await store.applyJob({ jobId: job1, deckIds: pod, gameCount: 4, update: firstSeatWins(4) });
    assertEqual(applied, true, 'applied');
    const rating = await store.getRating(a);
    assertEqual([rating?.gamesPlayed, rating?.wins], [4, 4], 'a stats');
    const counts = await store.getPairGameCounts();
    assertEqual(counts.get(pairKey(a, b)), 4, 'a|b');
    assertEqual(counts.get(pairKey(c, d)), 4, 'c|d');
  });

  await test('applyJob applies a job only once', async () => {
    const applied = await store.applyJob({ jobId: job1, deckIds: pod, gameCount: 4, update: firstSeatWins(4) });
    assertEqual(applied, false, 'second apply');
    assertEqual((await store.getRating(a))?.gamesPlayed, 4, 'games unchanged');
    assertEqual((await store.getPairGameCounts()).get(pairKey(a, b)), 4, 'pairs unchanged');
  });

  await test('a job with no resolved winner counts pairs but leaves ratings', async () => {
    const e = `rating-test-${run}-e`;
    const applied = await store.applyJob({
      jobId: job2, deckIds: [a, b, c, e], gameCount: 2, update: () => null,
    });
    assertEqual(applied, true, 'applied');
    assertEqual((await store.getPairGameCounts()).get(pairKey(a, e)), 2, 'a|e');
    assertEqual((await store.getPairGameCounts()).get(pairKey(a, b)), 6, 'a|b');
    assertEqual(await store.getRating(e), null, 'e has no rating');
    assertEqual((await store.getRating(a))?.gamesPlayed, 4, 'a games unchanged');
  });

  await test('applyJob skips a job that no longer exists', async () => {
    const applied = await store.applyJob({ jobId: `missing-${run}`, deckIds: pod, gameCount: 4, update: firstSeatWins(4) });
    assertEqual(applied, false, 'applied');
    assertEqual((await store.getRating(a))?.gamesPlayed, 4, 'a games unchanged');
  });

  await test('the leaderboard leaves out decks with no rated games', async () => {
    const ids = (await store.getLeaderboard({ limit: 10_000 })).map((r) => r.deckId);
    assertEqual(ids.includes(a), true, 'a listed');
    assertEqual(ids.includes(`rating-test-${run}-e`), false, 'e not listed');
  });

  if (failed > 0) process.exit(1);
  console.log('\nAll tests passed!');
}

main();
