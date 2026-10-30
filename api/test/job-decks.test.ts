/**
 * Tests for job seats and resolveJobDecks, the decklists a worker gets for a
 * job (SQLite).
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
  const { resolveJobSeats } = await import('../lib/job-seats');
  const { saveDeck } = await import('../lib/saved-decks');
  const jobStore = await import('../lib/job-store-factory');

  const dck = '[Commander]\n1 Sol Ring\n';
  const ids = ['Alpha', 'Beta', 'Gamma', 'Delta'].map((name) => saveDeck(name, dck).filename);

  const seats = (deckIds: string[]) =>
    deckIds.map((deckId, i) => ({ deckId, name: `Seat ${i}`, link: null, colorIdentity: [] }));

  await test('resolveJobSeats copies each deck in order and lists unknown ids', async () => {
    const { seats: resolved, errors } = await resolveJobSeats([ids[1]!, 'missing.dck', ids[0]!]);
    assertEqual(resolved.map((s) => [s.deckId, s.name]), [[ids[1], 'beta'], [ids[0], 'alpha']], 'seats');
    assertEqual(resolved[0]!.link, null, 'link');
    assertEqual(errors, ['missing.dck'], 'errors');
  });

  await test('a job stores its seats as given', async () => {
    const job = await jobStore.createJob(seats(ids), 4);
    assertEqual((await jobStore.getJob(job.id))!.seats, seats(ids), 'seats');
  });

  await test('decks are read by id, keeping the names recorded on the job', async () => {
    const decks = await resolveJobDecks({ seats: seats(ids) });
    assertEqual(decks?.map((d) => d.name), ['Seat 0', 'Seat 1', 'Seat 2', 'Seat 3'], 'names');
    assertEqual(decks?.every((d) => d.dck.includes('Sol Ring')), true, 'content');
  });

  await test('a missing deck means no decks', async () => {
    const decks = await resolveJobDecks({ seats: seats([ids[0]!, ids[1]!, ids[2]!, 'missing.dck']) });
    assertEqual(decks, null, 'decks');
  });

  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (failed > 0) process.exit(1);
  console.log('\nAll tests passed!');
}

main();
