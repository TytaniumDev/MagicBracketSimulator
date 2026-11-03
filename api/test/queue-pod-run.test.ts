/**
 * Tests for queueing jobs and pod runs (SQLite): queueJob, queuePodRun and
 * mapWithLimit.
 * Runs in a temp directory so it never touches the local dev decks or jobs.
 *
 * Run with: npx tsx test/queue-pod-run.test.ts
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-pod-run-test-'));
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
  const { mapWithLimit } = await import('../lib/map-limit');
  const { queueJob } = await import('../lib/queue-job');
  const { queuePodRun } = await import('../lib/queue-pod-run');
  const { saveDeck } = await import('../lib/saved-decks');
  const { getPodRunStore } = await import('../lib/pod-run-store-factory');
  const { listPodRunsForJob } = await getPodRunStore().then((store) => ({
    listPodRunsForJob: store.listPodRunsForJob.bind(store),
  }));
  const jobStore = await import('../lib/job-store-factory');
  const { GAMES_PER_CONTAINER } = await import('../lib/types');

  const dck = '[Commander]\n1 Sol Ring\n';
  const deckIds = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta'].map((name) => saveDeck(name, dck).filename);
  const seats = (ids: string[]) => ids.map((deckId) => ({ deckId, name: deckId, link: null, colorIdentity: [] }));

  await test('mapWithLimit keeps input order and never runs more than the limit at once', async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapWithLimit([5, 1, 4, 2, 3, 0], 2, async (ms, i) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, ms));
      inFlight--;
      return i * 10;
    });
    assertEqual(out, [0, 10, 20, 30, 40, 50], 'results');
    assertEqual(peak, 2, 'peak in flight');
  });

  await test('mapWithLimit rejects with the first error and starts no new calls', async () => {
    const started: number[] = [];
    let error: unknown;
    try {
      await mapWithLimit([0, 1, 2, 3, 4], 1, async (n) => {
        started.push(n);
        if (n === 1) throw new Error('boom');
        return n;
      });
    } catch (err) {
      error = err;
    }
    assertEqual(error instanceof Error ? error.message : null, 'boom', 'error');
    assertEqual(started, [0, 1], 'calls started');
  });

  await test('queueJob writes the job with one pending sim per GAMES_PER_CONTAINER games', async () => {
    const job = await queueJob(seats(deckIds.slice(0, 4)), 12, { createdBy: 'u1' });
    const sims = await jobStore.getSimulationStatuses(job.id);
    assertEqual(sims.length, Math.ceil(12 / GAMES_PER_CONTAINER), 'sim count');
    assertEqual(sims.every((s) => s.state === 'PENDING'), true, 'all pending');
  });

  await test('queueJob with a used key returns that job and leaves its sims alone', async () => {
    const first = await queueJob(seats(deckIds.slice(0, 4)), 8, { createdBy: 'u1', idempotencyKey: 'job-key' });
    const [sim] = await jobStore.getSimulationStatuses(first.id);
    await jobStore.updateSimulationStatus(first.id, sim!.simId, { state: 'RUNNING', workerId: 'w1' });

    const again = await queueJob(seats(deckIds.slice(0, 4)), 8, { createdBy: 'u1', idempotencyKey: 'job-key' });
    assertEqual(again.id, first.id, 'same job');
    const sims = await jobStore.getSimulationStatuses(first.id);
    assertEqual(sims.find((s) => s.simId === sim!.simId)?.state, 'RUNNING', 'claimed sim kept');
  });

  await test('queuePodRun queues every 4-deck pod and saves them as one run', async () => {
    const result = await queuePodRun({ deckIds, simulations: 8, createdBy: 'u1', idempotencyKey: 'run-key' });
    if (!result.ok) throw new Error(`unexpected invalid decks: ${result.invalidDeckIds}`);
    const { run } = result;
    assertEqual(run.jobIds.length, 15, 'C(6, 4) pods');
    assertEqual(run.deckIds, deckIds, 'deck ids');
    assertEqual(run.deckNames.length, 6, 'deck names');

    const jobs = await Promise.all(run.jobIds.map((id) => jobStore.getJob(id)));
    const pods = jobs.map((j) => j!.seats.map((s) => s.deckId).join(','));
    assertEqual(new Set(pods).size, 15, 'every pod is distinct');
    assertEqual(jobs.every((j) => j!.status === 'QUEUED' && j!.simulations === 8), true, 'queued with games per pod');
    const sims = await Promise.all(run.jobIds.map((id) => jobStore.getSimulationStatuses(id)));
    assertEqual(sims.every((s) => s.length === 2), true, 'each pod has its sims');
    assertEqual((await listPodRunsForJob(run.jobIds[0]!)).map((r) => r.id), [run.id], 'jobs point at the run');
  });

  await test('queuePodRun retried with the same key returns the same run and pods', async () => {
    const first = await queuePodRun({ deckIds: deckIds.slice(0, 5), simulations: 4, createdBy: 'u1', idempotencyKey: 'retry-key' });
    const again = await queuePodRun({ deckIds: deckIds.slice(0, 5), simulations: 4, createdBy: 'u1', idempotencyKey: 'retry-key' });
    if (!first.ok || !again.ok) throw new Error('unexpected invalid decks');
    assertEqual(again.run.id, first.run.id, 'same run');
    assertEqual(again.run.jobIds, first.run.jobIds, 'same pods');
  });

  await test('queuePodRun lists unknown decks and queues nothing', async () => {
    const before = (await jobStore.listJobs({ limit: 200 })).jobs.length;
    const result = await queuePodRun({
      deckIds: [...deckIds.slice(0, 4), 'missing.dck'],
      simulations: 4,
      createdBy: 'u1',
    });
    assertEqual(result.ok ? [] : result.invalidDeckIds, ['missing.dck'], 'invalid decks');
    assertEqual((await jobStore.listJobs({ limit: 200 })).jobs.length, before, 'no jobs queued');
  });

  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (failed > 0) {
    console.log(`\n${failed} test(s) failed`);
    process.exit(1);
  }
  console.log('\nAll queue tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
