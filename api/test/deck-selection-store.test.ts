/**
 * Deck selection store contract tests: excluding a deck and including it
 * again.
 *
 * Exercises the factory so SQLite and Firestore are held to the same
 * behavior. Runs against SQLite by default, in a temp directory so it never
 * touches the local dev decks. To test Firestore parity, run with:
 *   GOOGLE_CLOUD_PROJECT=demo-test FIRESTORE_EMULATOR_HOST=localhost:8080 npx tsx test/deck-selection-store.test.ts
 *
 * Run with: npx tsx test/deck-selection-store.test.ts
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-selection-test-'));
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
  const { getDeckSelectionStore } = await import('../lib/deck-selection-store-factory');
  const { createDeck } = await import('../lib/deck-store-factory');
  const store = await getDeckSelectionStore();

  const dck = '[Commander]\n1 Sol Ring\n';
  const make = (name: string) => createDeck({ name, dck, ownerId: 'tester', ownerEmail: 'tester@example.com' });
  const [a, b] = await Promise.all([make(`Selection A ${Date.now()}`), make(`Selection B ${Date.now()}`)]);
  const mine = (ids: string[]) => ids.filter((id) => id === a.id || id === b.id);

  await test('a new deck is not excluded', async () => {
    assertEqual(mine(await store.getExcludedDeckIds()), [], 'excluded');
  });

  await test('excluding decks lists them, and excluding twice keeps one entry', async () => {
    await store.setDeckExcluded(a.id, true, 'admin@example.com');
    await store.setDeckExcluded(a.id, true, 'admin@example.com');
    const ids = await store.setDeckExcluded(b.id, true, 'admin@example.com');
    assertEqual(mine(ids), [a.id, b.id].sort(), 'excluded');
  });

  await test('including a deck again removes it', async () => {
    const ids = await store.setDeckExcluded(a.id, false, 'admin@example.com');
    assertEqual(mine(ids), [b.id], 'excluded');
  });

  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (failed > 0) process.exit(1);
  console.log('\nAll tests passed!');
}

main();
