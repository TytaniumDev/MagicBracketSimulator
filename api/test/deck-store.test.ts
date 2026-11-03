/**
 * Tests for the deck store's user decks (SQLite / saved decks folder).
 * Runs in a temp directory so it never touches the local dev decks.
 *
 * Run with: npx tsx test/deck-store.test.ts
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-store-test-'));
process.env.SAVED_DECKS_DIR = path.join(tmpDir, 'decks');
delete process.env.GOOGLE_CLOUD_PROJECT;
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
  const { createDeck, listAllDecks, getDeckById } = await import('../lib/deck-store-factory');
  const { toDck } = await import('../lib/ingestion');

  // The .dck an imported deck (ManaBox, Moxfield, ...) is saved as.
  const dck = toDck({
    name: 'Imported Deck',
    commanders: [{ name: 'Atraxa, Praetors\' Voice', quantity: 1, isCommander: true, setCode: 'c16', collectorNumber: '28' }],
    mainboard: [{ name: 'Sol Ring', quantity: 1 }],
  });

  const created = await createDeck({ name: 'Imported Deck', dck, ownerId: 'user-1', ownerEmail: 'user@example.com' });

  await test('a created deck names its commander', () => {
    assertEqual(created.primaryCommander, 'Atraxa, Praetors\' Voice', 'created');
  });

  await test('the deck list names a user deck\'s commander', async () => {
    const listed = (await listAllDecks()).find((d) => d.id === created.id);
    assertEqual(listed?.primaryCommander, 'Atraxa, Praetors\' Voice', 'listed');
    assertEqual((await getDeckById(created.id))?.primaryCommander, 'Atraxa, Praetors\' Voice', 'by id');
  });

  await test('a deck without a commander section has no commander', async () => {
    const deck = await createDeck({ name: 'No Commander', dck: '[main]\n1 Sol Ring\n', ownerId: 'user-1', ownerEmail: 'user@example.com' });
    assertEqual(deck.primaryCommander, null, 'created');
  });

  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (failed > 0) process.exit(1);
  console.log('\nAll tests passed!');
}

main();
