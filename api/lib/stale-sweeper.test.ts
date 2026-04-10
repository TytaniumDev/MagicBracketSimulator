/**
 * Tests for the stale-sweeper pure predicate and end-to-end sweep flow.
 * Run with: npx tsx lib/stale-sweeper.test.ts
 */
import type { SimulationStatus } from './types';
import {
  shouldHardCancelSim,
  SIM_HARD_CANCEL_THRESHOLD_MS,
  QUEUED_JOB_HARD_FAIL_THRESHOLD_MS,
} from './stale-sweeper';

interface TestResult { name: string; passed: boolean; error?: string; }
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

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function makeSim(state: SimulationStatus['state'], index = 0): SimulationStatus {
  return { simId: `sim_${String(index).padStart(3, '0')}`, index, state };
}

async function runTests() {
  console.log('Running stale-sweeper tests...\n');

  const baselineMs = 1_000_000; // arbitrary fixed point
  const overThreshold = baselineMs + SIM_HARD_CANCEL_THRESHOLD_MS + 1;
  const underThreshold = baselineMs + SIM_HARD_CANCEL_THRESHOLD_MS - 1;
  const atThreshold = baselineMs + SIM_HARD_CANCEL_THRESHOLD_MS;

  // ── Terminal states are never cancelled ──────────────────────────────

  await test('COMPLETED sim is never cancelled (any age)', () => {
    const sim = makeSim('COMPLETED');
    assert(
      shouldHardCancelSim(sim, baselineMs, baselineMs + 1_000_000_000) === false,
      'should return false'
    );
  });

  await test('CANCELLED sim is never cancelled (idempotent)', () => {
    const sim = makeSim('CANCELLED');
    assert(
      shouldHardCancelSim(sim, baselineMs, baselineMs + 1_000_000_000) === false,
      'should return false'
    );
  });

  // ── Non-terminal states below threshold ──────────────────────────────

  await test('PENDING sim below threshold is not cancelled', () => {
    const sim = makeSim('PENDING');
    assert(
      shouldHardCancelSim(sim, baselineMs, underThreshold) === false,
      'should return false'
    );
  });

  await test('RUNNING sim below threshold is not cancelled', () => {
    const sim = makeSim('RUNNING');
    assert(
      shouldHardCancelSim(sim, baselineMs, underThreshold) === false,
      'should return false'
    );
  });

  await test('FAILED sim below threshold is not cancelled', () => {
    const sim = makeSim('FAILED');
    assert(
      shouldHardCancelSim(sim, baselineMs, underThreshold) === false,
      'should return false'
    );
  });

  // ── Non-terminal states above threshold ──────────────────────────────

  await test('PENDING sim above threshold is cancelled', () => {
    const sim = makeSim('PENDING');
    assert(
      shouldHardCancelSim(sim, baselineMs, overThreshold) === true,
      'should return true'
    );
  });

  await test('RUNNING sim above threshold is cancelled', () => {
    const sim = makeSim('RUNNING');
    assert(
      shouldHardCancelSim(sim, baselineMs, overThreshold) === true,
      'should return true'
    );
  });

  await test('FAILED sim above threshold is cancelled', () => {
    const sim = makeSim('FAILED');
    assert(
      shouldHardCancelSim(sim, baselineMs, overThreshold) === true,
      'should return true'
    );
  });

  // ── Boundary ──────────────────────────────────────────────────────────

  await test('exactly at threshold is not cancelled (strict >)', () => {
    const sim = makeSim('RUNNING');
    assert(
      shouldHardCancelSim(sim, baselineMs, atThreshold) === false,
      'should return false'
    );
  });

  // ── Custom threshold ──────────────────────────────────────────────────

  await test('custom threshold is respected', () => {
    const sim = makeSim('RUNNING');
    const customThreshold = 1000;
    assert(
      shouldHardCancelSim(sim, 0, 1001, customThreshold) === true,
      'should return true above custom threshold'
    );
    assert(
      shouldHardCancelSim(sim, 0, 999, customThreshold) === false,
      'should return false below custom threshold'
    );
  });

  // ── Integration: sweepStaleJobs against SQLite ───────────────────────
  //
  // These tests exercise the full sweeper flow against the real SQLite
  // job store. If better-sqlite3's native binding is not loadable
  // (e.g. local dev on a node version that does not match the compiled
  // binding), we gracefully skip the integration portion. CI runs
  // `npm ci` on the pinned node version so the binding is always fresh
  // there and the integration tests always execute in CI.

  const fs = await import('fs');
  const path = await import('path');
  const os = await import('os');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stale-sweeper-test-'));
  process.env.LOGS_DATA_DIR = tempDir;
  // Ensure we are in LOCAL mode for this test run.
  delete process.env.GOOGLE_CLOUD_PROJECT;

  // Dynamic imports so env vars are set before module init.
  let jobStoreSqlite: typeof import('./job-store');
  let sweep: typeof import('./stale-sweeper').sweepStaleJobs;
  try {
    jobStoreSqlite = await import('./job-store');
    ({ sweepStaleJobs: sweep } = await import('./stale-sweeper'));
    // Touch the DB once so a binding error surfaces before we start testing.
    jobStoreSqlite.listActiveJobs();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('bindings file') || message.includes('better_sqlite3')) {
      console.log(
        '\n⚠︎  Skipping SQLite integration tests — better-sqlite3 binding not loadable in this environment.'
      );
      console.log(`   ${message.split('\n')[0]}`);
      console.log(`\n${results.filter(r => r.passed).length}/${results.length} passed (integration skipped)`);
      if (results.some(r => !r.passed)) process.exit(1);
      return;
    }
    throw err;
  }

  type DeckSlot = import('./types').DeckSlot;
  const DECKS: DeckSlot[] = [
    { name: 'A', dck: 'a' },
    { name: 'B', dck: 'b' },
    { name: 'C', dck: 'c' },
    { name: 'D', dck: 'd' },
  ];

  function makeRunningJob(simCount: number): string {
    const job = jobStoreSqlite.createJob(DECKS, simCount * 4);
    jobStoreSqlite.updateJobStatus(job.id, 'RUNNING');
    jobStoreSqlite.initializeSimulations(job.id, simCount);
    return job.id;
  }

  function cleanupJob(jobId: string) {
    try {
      jobStoreSqlite.deleteSimulations(jobId);
      jobStoreSqlite.deleteJob(jobId);
    } catch {
      // best-effort cleanup
    }
  }

  // Helper: wipe any leftover jobs from earlier tests to keep scanned counts predictable.
  function wipeAllActiveJobs() {
    const leftover = jobStoreSqlite.listActiveJobs();
    for (const j of leftover) cleanupJob(j.id);
  }

  await test('empty active job list returns scanned=0', async () => {
    wipeAllActiveJobs();
    const result = await sweep();
    assert(result.scanned === 0, `scanned should be 0, got ${result.scanned}`);
    assert(result.simsCancelled === 0, 'simsCancelled should be 0');
    assert(result.jobsFailed === 0, 'jobsFailed should be 0');
    assert(result.errors.length === 0, 'errors should be empty');
  });

  await test('young RUNNING job is not touched', async () => {
    wipeAllActiveJobs();
    const jobId = makeRunningJob(2);
    try {
      const result = await sweep(Date.now()); // no staleness
      assert(result.scanned === 1, `scanned should be 1, got ${result.scanned}`);
      assert(result.simsCancelled === 0, 'no sims should be cancelled');
      const sims = jobStoreSqlite.getSimulationStatuses(jobId);
      assert(sims.every((s) => s.state === 'PENDING'), 'sims should still be PENDING');
    } finally {
      cleanupJob(jobId);
    }
  });

  await test('old RUNNING job with stuck sims has them cancelled and aggregates', async () => {
    wipeAllActiveJobs();
    const jobId = makeRunningJob(2);
    try {
      // Mark one sim as genuinely COMPLETED so aggregation has something to
      // work with (but no raw logs, which is fine — aggregateJobResults just
      // flips the status).
      jobStoreSqlite.updateSimulationStatus(jobId, 'sim_000', { state: 'COMPLETED' });
      // The other sim stays PENDING — it's the "stuck" one.

      // Sweep with a nowMs well past the 2h threshold.
      const farFuture = Date.now() + SIM_HARD_CANCEL_THRESHOLD_MS + 60_000;
      const result = await sweep(farFuture);

      assert(result.simsCancelled === 1, `one sim should be cancelled, got ${result.simsCancelled}`);
      assert(result.aggregationsTriggered === 1, `aggregation should fire, got ${result.aggregationsTriggered}`);

      const sims = jobStoreSqlite.getSimulationStatuses(jobId);
      const stuckSim = sims.find((s) => s.simId === 'sim_001');
      assert(stuckSim!.state === 'CANCELLED', `sim_001 should be CANCELLED, got ${stuckSim!.state}`);

      const finalJob = jobStoreSqlite.getJob(jobId);
      // After aggregateJobResults on an all-terminal job, status should
      // transition to COMPLETED (in local mode the aggregation runs inline).
      assert(finalJob!.status === 'COMPLETED', `job should be COMPLETED, got ${finalJob!.status}`);
    } finally {
      cleanupJob(jobId);
    }
  });

  await test('old QUEUED job is hard-failed', async () => {
    wipeAllActiveJobs();
    const job = jobStoreSqlite.createJob(DECKS, 4);
    const jobId = job.id;
    try {
      // Job is QUEUED by default on creation.
      assert(jobStoreSqlite.getJob(jobId)!.status === 'QUEUED', 'pre: should be QUEUED');

      const farFuture = Date.now() + QUEUED_JOB_HARD_FAIL_THRESHOLD_MS + 60_000;
      const result = await sweep(farFuture);

      assert(result.jobsFailed === 1, `one job should be hard-failed, got ${result.jobsFailed}`);
      const finalJob = jobStoreSqlite.getJob(jobId);
      assert(finalJob!.status === 'FAILED', `job should be FAILED, got ${finalJob!.status}`);
      assert(
        (finalJob!.errorMessage ?? '').includes('Hard-failed'),
        'errorMessage should contain Hard-failed'
      );
    } finally {
      cleanupJob(jobId);
    }
  });

  // ── Summary ───────────────────────────────────────────────────────────

  console.log(`\n${results.filter(r => r.passed).length}/${results.length} passed`);
  if (results.some(r => !r.passed)) {
    console.log('\nFailures:');
    results.filter(r => !r.passed).forEach(r => console.log(`  - ${r.name}: ${r.error}`));
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
