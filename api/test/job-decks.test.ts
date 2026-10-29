/**
 * Tests for resolveJobDecks: the decklists a worker gets for a job (SQLite).
 * Runs in a temp directory so it never touches the local dev decks.
 *
 * Run with: npx tsx test/job-decks.test.ts
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'job-decks-test-'));
process.env.FORGE_ENGINE_PATH = path.join(tmpDir, 'forge-engine');
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
  const { resolveJobDecks } = await import('../lib/job-decks');
  const { saveDeck } = await import('../lib/saved-decks');
  const jobStore = await import('../lib/job-store-factory');

  const dck = '[Commander]\n1 Sol Ring\n';
  const ids = ['Alpha', 'Beta', 'Gamma', 'Delta'].map((name) => saveDeck(name, dck).filename);

  await test('a job with deck ids records names only', async () => {
    const job = await jobStore.createJob(ids.map((_, i) => ({ name: `Seat ${i}`, dck })), 4, { deckIds: ids });
    const stored = await jobStore.getJob(job.id);
    assertEqual(stored!.decks, [0, 1, 2, 3].map((i) => ({ name: `Seat ${i}` })), 'stored decks');
  });

  await test('decks are read by id, keeping the names recorded on the job', async () => {
    const decks = await resolveJobDecks({ decks: ids.map((_, i) => ({ name: `Seat ${i}` })), deckIds: ids });
    assertEqual(decks?.map((d) => d.name), ['Seat 0', 'Seat 1', 'Seat 2', 'Seat 3'], 'names');
    assertEqual(decks?.every((d) => d.dck.includes('Sol Ring')), true, 'content');
  });

  await test('decklists embedded on an older job are served as stored', async () => {
    const embedded = ids.map((_, i) => ({ name: `Old ${i}`, dck: `old ${i}` }));
    assertEqual(await resolveJobDecks({ decks: embedded }), embedded, 'decks');
  });

  await test('a missing deck means no decks', async () => {
    const decks = await resolveJobDecks({
      decks: ids.map((_, i) => ({ name: `Seat ${i}` })),
      deckIds: [ids[0]!, ids[1]!, ids[2]!, 'missing.dck'],
    });
    assertEqual(decks, null, 'decks');
  });

  await test('a job without deck ids or content has no decks', async () => {
    assertEqual(await resolveJobDecks({ decks: ids.map((_, i) => ({ name: `Seat ${i}` })) }), null, 'decks');
  });

  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (failed > 0) process.exit(1);
  console.log('\nAll tests passed!');
}

main();
