/**
 * Deck summary contract tests: a rated deck lists with its win stats, and a
 * data wipe of ratings clears them.
 *
 * Exercises the factories so SQLite and Firestore are held to the same
 * behavior. Runs against SQLite by default, in a temp directory so it never
 * touches the local dev decks or database. To test Firestore parity, run with:
 *   GOOGLE_CLOUD_PROJECT=demo-test FIRESTORE_EMULATOR_HOST=localhost:8080 npx tsx test/deck-summary.test.ts
 *
 * Run with: npx tsx test/deck-summary.test.ts
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { DeckRating } from '../lib/types';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-summary-test-'));
process.env.FORGE_ENGINE_PATH = path.join(tmpDir, 'forge-engine');
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

async function main() {
  // Imported after the env and cwd are set, since modules read them on load.
  const { createDeck, listAllDecks } = await import('../lib/deck-store-factory');
  const { createJob } = await import('../lib/job-store-factory');
  const { getRatingStore } = await import('../lib/rating-store-factory');
  const { getDataWipeStore } = await import('../lib/data-wipe-store-factory');
  const { deckSummary } = await import('../lib/rating-store');
  const { testSeats } = await import('./seats');

  const dck = '[Commander]\n1 Sol Ring\n';
  const run = Date.now();
  const decks = await Promise.all(
    ['A', 'B', 'C', 'D'].map((x) => createDeck({ name: `Summary ${x} ${run}`, dck, ownerId: 'tester', ownerEmail: 'tester@example.com' })),
  );
  const pod = decks.map((d) => d.id);
  const summaryOf = async (id: string) => (await listAllDecks()).find((d) => d.id === id)?.summary ?? null;

  await test('deckSummary derives the win rate', () => {
    assertEqual(deckSummary({ gamesPlayed: 4, wins: 1 }), { gamesPlayed: 4, wins: 1, winRate: 0.25 }, '1 of 4');
    assertEqual(deckSummary({ gamesPlayed: 0, wins: 0 }).winRate, 0, 'no games');
  });

  await test('a deck with no rated games has no summary', async () => {
    assertEqual(await summaryOf(pod[0]!), null, 'summary');
  });

  await test('a rated deck lists with its games, wins and win rate', async () => {
    const { id: jobId } = await createJob(testSeats(decks.map((d) => d.name)), 4);
    // Each deck plays 4 games, and the first seat wins them all.
    const update = (stored: (DeckRating | null)[]) =>
      stored.map((_, i) => ({
        deckId: pod[i]!,
        mu: 25,
        sigma: 25 / 3,
        gamesPlayed: 4,
        wins: i === 0 ? 4 : 0,
        lastUpdated: new Date().toISOString(),
      }));
    const applied = await getRatingStore().applyJob({ jobId, deckIds: pod, gameCount: 4, update });
    assertEqual(applied, true, 'applied');
    assertEqual(await summaryOf(pod[0]!), { gamesPlayed: 4, wins: 4, winRate: 1 }, 'winner');
    assertEqual(await summaryOf(pod[1]!), { gamesPlayed: 4, wins: 0, winRate: 0 }, 'loser');
  });

  await test('wiping ratings clears deck summaries', async () => {
    const store = getDataWipeStore();
    while ((await store.deleteLeftovers('ratings', 500)) > 0);
    while ((await store.deleteLeftovers('deckSummaries', 500)) > 0);
    assertEqual(await summaryOf(pod[0]!), null, 'summary');
  });

  if (failed > 0) process.exit(1);
  console.log('\nAll tests passed!');
}

main();
