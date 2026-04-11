# Stuck Job Prevention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a scheduled sweeper that guarantees active jobs eventually reach a terminal state by hard-cancelling any simulation older than 2h and then letting the existing recovery + aggregation path finalize the job.

**Architecture:** A new module `api/lib/stale-sweeper.ts` holds a pure predicate (`shouldHardCancelSim`) plus side-effecting helpers (`hardCancelStaleSimsForJob`, `hardFailStaleQueuedJob`, `sweepStaleJobs`). A new Next.js route `api/app/api/admin/sweep-stale-jobs/route.ts` wraps `sweepStaleJobs` and is authed via the existing `WORKER_SECRET` header. Cloud Scheduler (configured manually, documented in `docs/STALE_SWEEPER.md`) fires the endpoint every 15 minutes.

**Tech Stack:** Next.js 15 App Router, TypeScript, `@google-cloud/firestore`, SQLite (`better-sqlite3`) for local mode, `@sentry/nextjs`, `tsx` for tests.

**Spec:** `docs/superpowers/specs/2026-04-10-stuck-job-prevention-design.md`

---

## Task 1: Create stale-sweeper module with pure predicate

**Files:**
- Create: `api/lib/stale-sweeper.ts`

- [ ] **Step 1: Create `api/lib/stale-sweeper.ts` with the predicate and types**

```typescript
/**
 * Stale job sweeper — eventually resolves stuck jobs by hard-cancelling any
 * simulation that has exceeded an absolute lifetime cap (default 2 hours).
 *
 * The sweeper is invoked by Cloud Scheduler via POST /api/admin/sweep-stale-jobs
 * and is safe to run repeatedly: it uses conditional writes so a worker
 * completing a sim at the last second always wins over a sweeper cancel.
 *
 * In both local (SQLite) and GCP (Firestore) modes, it:
 *   1. Hard-fails any QUEUED job older than QUEUED_JOB_HARD_FAIL_THRESHOLD_MS.
 *   2. For each RUNNING job, cancels any sim where (now - job baseline) exceeds
 *      SIM_HARD_CANCEL_THRESHOLD_MS.
 *   3. Calls the existing recoverStaleJob() path to republish stale-PENDING
 *      sims and re-trigger aggregation where applicable.
 *   4. Explicitly triggers aggregation when the job is in a state where
 *      recoverStaleJob's built-in re-trigger does not fire (local mode).
 */
import * as Sentry from '@sentry/nextjs';
import type { Job, SimulationStatus } from './types';
import * as jobStore from './job-store-factory';

export const SIM_HARD_CANCEL_THRESHOLD_MS = parseInt(
  process.env.SIM_HARD_CANCEL_THRESHOLD_MS ?? '7200000',
  10
); // 2 hours

export const QUEUED_JOB_HARD_FAIL_THRESHOLD_MS = parseInt(
  process.env.QUEUED_JOB_HARD_FAIL_THRESHOLD_MS ?? '7200000',
  10
); // 2 hours

export interface SweepResult {
  scanned: number;
  simsCancelled: number;
  jobsFailed: number;
  recoveriesTriggered: number;
  aggregationsTriggered: number;
  errors: { jobId: string; error: string }[];
}

/**
 * Pure predicate: should this sim be hard-cancelled right now?
 *
 * @param sim The simulation to check.
 * @param jobBaselineMs `job.startedAt?.getTime() ?? job.createdAt.getTime()`.
 *   Every sim in a job shares the same baseline so the 2h budget measures
 *   "time since the job started processing", not "time since this sim was
 *   most recently attempted". This gives a user-legible invariant:
 *   no sim can block a job more than 2h after the job started.
 * @param nowMs Current time in ms (injected for testability).
 * @param thresholdMs The cap; defaults to SIM_HARD_CANCEL_THRESHOLD_MS.
 */
export function shouldHardCancelSim(
  sim: SimulationStatus,
  jobBaselineMs: number,
  nowMs: number,
  thresholdMs: number = SIM_HARD_CANCEL_THRESHOLD_MS
): boolean {
  if (sim.state === 'COMPLETED' || sim.state === 'CANCELLED') return false;
  return nowMs - jobBaselineMs > thresholdMs;
}

function jobBaselineMs(job: Job): number {
  return (job.startedAt ?? job.createdAt).getTime();
}
```

- [ ] **Step 2: Type check**

Run: `npm run lint --prefix api`
Expected: PASS (no type errors).

- [ ] **Step 3: Commit**

```bash
git add api/lib/stale-sweeper.ts
git commit -m "feat(api): add stale-sweeper module scaffold with pure predicate"
```

---

## Task 2: Unit tests for the pure predicate

**Files:**
- Create: `api/lib/stale-sweeper.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `api/lib/stale-sweeper.test.ts`:

```typescript
/**
 * Tests for the stale-sweeper pure predicate and (later) the integration path.
 * Run with: npx tsx lib/stale-sweeper.test.ts
 */
import type { SimulationStatus } from './types';
import { shouldHardCancelSim, SIM_HARD_CANCEL_THRESHOLD_MS } from './stale-sweeper';

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
```

- [ ] **Step 2: Run the tests**

Run: `cd api && npx tsx lib/stale-sweeper.test.ts`
Expected: `10/10 passed`

- [ ] **Step 3: Commit**

```bash
git add api/lib/stale-sweeper.test.ts
git commit -m "test(api): add stale-sweeper predicate unit tests"
```

---

## Task 3: Implement the side-effecting sweep helpers

**Files:**
- Modify: `api/lib/stale-sweeper.ts`

- [ ] **Step 1: Add `hardCancelStaleSimsForJob` below the predicate**

Append to `api/lib/stale-sweeper.ts`:

```typescript
/**
 * Hard-cancel every sim on the given job that has exceeded the lifetime cap.
 * Uses conditional writes so a worker completing a sim at the last second
 * wins the race (the cancel becomes a no-op).
 *
 * Returns the number of sims that were actually cancelled (races lost excluded).
 */
export async function hardCancelStaleSimsForJob(
  job: Job,
  nowMs: number
): Promise<number> {
  const sims = await jobStore.getSimulationStatuses(job.id);
  if (sims.length === 0) return 0;

  const baselineMs = jobBaselineMs(job);
  let cancelled = 0;
  const message = `Hard-cancelled by stale-sweeper after exceeding ${Math.round(
    SIM_HARD_CANCEL_THRESHOLD_MS / 60000
  )}m lifetime cap`;

  for (const sim of sims) {
    if (!shouldHardCancelSim(sim, baselineMs, nowMs)) continue;
    const updated = await jobStore.conditionalUpdateSimulationStatus(
      job.id,
      sim.simId,
      ['PENDING', 'RUNNING', 'FAILED'],
      {
        state: 'CANCELLED',
        errorMessage: message,
        completedAt: new Date(nowMs).toISOString(),
      }
    );
    if (updated) cancelled += 1;
  }

  return cancelled;
}

/**
 * Hard-fail a QUEUED job that has sat unclaimed past the absolute cap.
 * Returns true if the job was transitioned to FAILED.
 */
export async function hardFailStaleQueuedJob(
  job: Job,
  nowMs: number
): Promise<boolean> {
  if (job.status !== 'QUEUED') return false;
  const ageMs = nowMs - job.createdAt.getTime();
  if (ageMs <= QUEUED_JOB_HARD_FAIL_THRESHOLD_MS) return false;

  await jobStore.setJobFailed(
    job.id,
    `Hard-failed by stale-sweeper: job remained QUEUED for ${Math.round(
      ageMs / 60000
    )}m without being claimed by a worker`
  );
  return true;
}
```

- [ ] **Step 2: Type check**

Run: `npm run lint --prefix api`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add api/lib/stale-sweeper.ts
git commit -m "feat(api): add hardCancelStaleSimsForJob + hardFailStaleQueuedJob"
```

---

## Task 4: Implement the top-level `sweepStaleJobs` entrypoint

**Files:**
- Modify: `api/lib/stale-sweeper.ts`

- [ ] **Step 1: Append `sweepStaleJobs` to `api/lib/stale-sweeper.ts`**

```typescript
/**
 * Run one sweep cycle over every active (QUEUED or RUNNING) job.
 *
 * For each job, in order:
 *   1. If QUEUED and too old → hard-fail and skip the rest.
 *   2. If RUNNING → hard-cancel any sims past the 2h baseline.
 *   3. Call jobStore.recoverStaleJob() — this is the existing path that
 *      republishes stale-PENDING sims and re-triggers aggregation in
 *      Firestore/Pub/Sub mode.
 *   4. If the job is still RUNNING and every sim is terminal, explicitly
 *      call aggregateJobResults. This covers local (SQLite) mode, where
 *      recoverStaleJob's built-in re-trigger does not fire.
 *
 * Per-job errors are isolated: one broken job does not halt the sweep.
 * Errors are logged to Sentry with `component: 'stale-sweeper'` and also
 * collected into SweepResult.errors for the HTTP response.
 *
 * @param nowMs Injected clock, defaults to Date.now(). Tests can pass a
 *   fixed future time to simulate aged jobs without manipulating DB rows.
 */
export async function sweepStaleJobs(nowMs: number = Date.now()): Promise<SweepResult> {
  const activeJobs = await jobStore.listActiveJobs();
  const result: SweepResult = {
    scanned: activeJobs.length,
    simsCancelled: 0,
    jobsFailed: 0,
    recoveriesTriggered: 0,
    aggregationsTriggered: 0,
    errors: [],
  };

  for (const job of activeJobs) {
    try {
      if (job.status === 'QUEUED') {
        const failed = await hardFailStaleQueuedJob(job, nowMs);
        if (failed) {
          result.jobsFailed += 1;
          continue;
        }
      }

      if (job.status === 'RUNNING') {
        const cancelled = await hardCancelStaleSimsForJob(job, nowMs);
        result.simsCancelled += cancelled;
      }

      const recovered = await jobStore.recoverStaleJob(job.id);
      if (recovered) result.recoveriesTriggered += 1;

      // Local mode + post-cancel catch-up: if the job is still RUNNING but
      // every sim is terminal, explicitly aggregate. recoverStaleJob's
      // built-in re-trigger is gated on GCP mode, so we cover the gap here.
      const refreshed = await jobStore.getJob(job.id);
      if (refreshed && refreshed.status === 'RUNNING') {
        const sims = await jobStore.getSimulationStatuses(job.id);
        const allTerminal =
          sims.length > 0 &&
          sims.every((s) => s.state === 'COMPLETED' || s.state === 'CANCELLED');
        if (allTerminal) {
          await jobStore.aggregateJobResults(job.id);
          result.aggregationsTriggered += 1;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      Sentry.captureException(err, {
        tags: { component: 'stale-sweeper', jobId: job.id },
      });
      console.error(`[StaleSweeper] job=${job.id} error:`, message);
      result.errors.push({ jobId: job.id, error: message });
    }
  }

  return result;
}
```

- [ ] **Step 2: Type check**

Run: `npm run lint --prefix api`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add api/lib/stale-sweeper.ts
git commit -m "feat(api): add sweepStaleJobs orchestrator"
```

---

## Task 5: Integration tests for sweepStaleJobs using SQLite

**Files:**
- Modify: `api/lib/stale-sweeper.test.ts`

- [ ] **Step 1: Append integration tests to `api/lib/stale-sweeper.test.ts`**

Insert **before** the `// ── Summary ──` section:

```typescript
  // ── Integration: sweepStaleJobs against SQLite ───────────────────────

  const fs = await import('fs');
  const path = await import('path');
  const os = await import('os');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stale-sweeper-test-'));
  process.env.LOGS_DATA_DIR = tempDir;
  // Ensure we are in LOCAL mode for this test run.
  delete process.env.GOOGLE_CLOUD_PROJECT;

  // Dynamic imports so env vars are set before module init.
  const jobStoreSqlite = await import('./job-store');
  const { sweepStaleJobs: sweep } = await import('./stale-sweeper');

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

  await test('empty active job list returns scanned=0', async () => {
    // Ensure no leftover jobs from other tests
    const before = jobStoreSqlite.listActiveJobs();
    for (const j of before) cleanupJob(j.id);

    const result = await sweep();
    assert(result.scanned === 0, `scanned should be 0, got ${result.scanned}`);
    assert(result.simsCancelled === 0, 'simsCancelled should be 0');
    assert(result.jobsFailed === 0, 'jobsFailed should be 0');
    assert(result.errors.length === 0, 'errors should be empty');
  });

  await test('young RUNNING job is not touched', async () => {
    const jobId = makeRunningJob(2);
    try {
      const now = Date.now(); // just-now, no sims stale
      const result = await sweep(now);
      assert(result.scanned >= 1, 'should scan at least this job');
      assert(result.simsCancelled === 0, 'no sims should be cancelled');
      const sims = jobStoreSqlite.getSimulationStatuses(jobId);
      assert(sims.every((s) => s.state === 'PENDING'), 'sims should still be PENDING');
    } finally {
      cleanupJob(jobId);
    }
  });

  await test('old RUNNING job with stuck sims has them cancelled and aggregates', async () => {
    const jobId = makeRunningJob(2);
    try {
      // Mark one sim as genuinely COMPLETED so aggregation has something to
      // work with (but no raw logs, which is fine — aggregateJobResults just
      // flips the status).
      jobStoreSqlite.updateSimulationStatus(jobId, 'sim_000', { state: 'COMPLETED' });
      // The other sim stays PENDING — it's the "stuck" one.

      // Sweep with a nowMs well past the 2h threshold
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
    const job = jobStoreSqlite.createJob(DECKS, 4);
    const jobId = job.id;
    try {
      // Job is QUEUED by default on creation
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
```

Also add `QUEUED_JOB_HARD_FAIL_THRESHOLD_MS` to the existing import line at the top:

Change:
```typescript
import { shouldHardCancelSim, SIM_HARD_CANCEL_THRESHOLD_MS } from './stale-sweeper';
```
to:
```typescript
import { shouldHardCancelSim, SIM_HARD_CANCEL_THRESHOLD_MS, QUEUED_JOB_HARD_FAIL_THRESHOLD_MS } from './stale-sweeper';
```

- [ ] **Step 2: Run the tests**

Run: `cd api && npx tsx lib/stale-sweeper.test.ts`
Expected: `14/14 passed`

- [ ] **Step 3: Commit**

```bash
git add api/lib/stale-sweeper.test.ts
git commit -m "test(api): add stale-sweeper SQLite integration tests"
```

---

## Task 6: HTTP endpoint

**Files:**
- Create: `api/app/api/admin/sweep-stale-jobs/route.ts`

- [ ] **Step 1: Create the route file**

```typescript
/**
 * POST /api/admin/sweep-stale-jobs — Run one pass of the stale-job sweeper.
 *
 * Invoked on a 15-minute schedule by Cloud Scheduler. Authed with the existing
 * WORKER_SECRET header (same as /api/admin/pull-image). In local mode the
 * auth check is bypassed so the endpoint is callable in dev without setup.
 *
 * Returns a SweepResult JSON describing what was scanned, cancelled, and
 * aggregated. Errors inside individual job processing are captured to Sentry
 * and also surfaced in the response so the Cloud Scheduler invocation log
 * shows them.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isWorkerRequest } from '@/lib/auth';
import { sweepStaleJobs } from '@/lib/stale-sweeper';
import { errorResponse } from '@/lib/api-response';

const IS_LOCAL_MODE = !process.env.GOOGLE_CLOUD_PROJECT;

export async function POST(req: NextRequest) {
  if (!IS_LOCAL_MODE && !isWorkerRequest(req)) {
    return errorResponse('Unauthorized', 401);
  }

  try {
    const result = await sweepStaleJobs();
    return NextResponse.json(result);
  } catch (error) {
    console.error('[StaleSweeper] Error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Sweep failed', 500);
  }
}
```

- [ ] **Step 2: Type check**

Run: `npm run lint --prefix api`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add api/app/api/admin/sweep-stale-jobs/route.ts
git commit -m "feat(api): add POST /api/admin/sweep-stale-jobs endpoint"
```

---

## Task 7: Wire the test file into `test:unit`

**Files:**
- Modify: `api/package.json`

- [ ] **Step 1: Append `tsx lib/stale-sweeper.test.ts` to the `test:unit` chain**

In `api/package.json`, change:
```json
"test:unit": "tsx test/state-machine.test.ts && tsx test/game-logs.test.ts && tsx lib/condenser/condenser.test.ts && tsx lib/condenser/structured.test.ts && tsx lib/condenser/derive-job-status.test.ts && tsx lib/condenser/win-tally.test.ts && tsx lib/condenser/pipeline.test.ts && tsx lib/log-store.test.ts && tsx lib/store-guards.test.ts && tsx lib/job-store-aggregation.test.ts && tsx lib/validation.test.ts && tsx test/cors.test.ts && tsx test/cors-wildcard.test.ts && tsx test/job-store-contract.test.ts && tsx test/cancel-recover.test.ts",
```
to:
```json
"test:unit": "tsx test/state-machine.test.ts && tsx test/game-logs.test.ts && tsx lib/condenser/condenser.test.ts && tsx lib/condenser/structured.test.ts && tsx lib/condenser/derive-job-status.test.ts && tsx lib/condenser/win-tally.test.ts && tsx lib/condenser/pipeline.test.ts && tsx lib/log-store.test.ts && tsx lib/store-guards.test.ts && tsx lib/job-store-aggregation.test.ts && tsx lib/validation.test.ts && tsx lib/stale-sweeper.test.ts && tsx test/cors.test.ts && tsx test/cors-wildcard.test.ts && tsx test/job-store-contract.test.ts && tsx test/cancel-recover.test.ts",
```

- [ ] **Step 2: Run the full unit test suite**

Run: `npm run test:unit --prefix api`
Expected: ALL tests pass.

- [ ] **Step 3: Commit**

```bash
git add api/package.json
git commit -m "chore(api): wire stale-sweeper tests into test:unit"
```

---

## Task 8: Operational documentation

**Files:**
- Create: `docs/STALE_SWEEPER.md`

- [ ] **Step 1: Create the doc**

```markdown
# Stale Job Sweeper

A scheduled safety net that guarantees every active Magic Bracket Simulator
job eventually reaches a terminal state (`COMPLETED`, `FAILED`, or
`CANCELLED`) without manual intervention.

## What it does

Every 15 minutes, Cloud Scheduler hits `POST /api/admin/sweep-stale-jobs`.
For each `QUEUED` or `RUNNING` job, the endpoint:

1. **Hard-fails** any job that has sat `QUEUED` for more than 2 hours
   (`QUEUED_JOB_HARD_FAIL_THRESHOLD_MS`, default `7200000`).
2. **Hard-cancels** any simulation on a `RUNNING` job whose age (since
   `job.startedAt`, falling back to `job.createdAt`) exceeds 2 hours
   (`SIM_HARD_CANCEL_THRESHOLD_MS`, default `7200000`). Cancellation uses
   conditional Firestore writes so a worker completing a sim at the last
   millisecond always wins the race.
3. **Runs the existing recovery path** (`recoverStaleJob`) to re-publish
   stale-PENDING Pub/Sub messages and re-trigger aggregation.
4. **Explicitly triggers aggregation** for local-mode jobs where every sim
   is now terminal (Firestore mode's recovery already does this).

The endpoint returns a JSON `SweepResult`:
```json
{
  "scanned": 3,
  "simsCancelled": 1,
  "jobsFailed": 0,
  "recoveriesTriggered": 2,
  "aggregationsTriggered": 1,
  "errors": []
}
```

Per-job errors are logged to Sentry (`component: stale-sweeper`) and also
included in `SweepResult.errors`.

## One-time Cloud Scheduler setup

```bash
SECRET=$(gcloud secrets versions access latest \
  --secret=worker-secret \
  --project=magic-bracket-simulator)

gcloud scheduler jobs create http stale-sweeper \
  --project=magic-bracket-simulator \
  --location=us-central1 \
  --schedule="*/15 * * * *" \
  --uri="https://api--magic-bracket-simulator.us-central1.hosted.app/api/admin/sweep-stale-jobs" \
  --http-method=POST \
  --headers="X-Worker-Secret=$SECRET" \
  --description="Eventually recovers stuck jobs via /api/admin/sweep-stale-jobs"
```

Cloud Scheduler's free tier covers 3 scheduled jobs per month — this uses 1.

## Manual invocation

```bash
SECRET=$(gcloud secrets versions access latest \
  --secret=worker-secret \
  --project=magic-bracket-simulator)

curl -s -X POST \
  -H "X-Worker-Secret: $SECRET" \
  https://api--magic-bracket-simulator.us-central1.hosted.app/api/admin/sweep-stale-jobs \
  | jq
```

## Tunables

| Env var | Default | Meaning |
|---------|---------|---------|
| `SIM_HARD_CANCEL_THRESHOLD_MS` | `7200000` (2h) | Max lifetime for a non-terminal sim before it's force-cancelled |
| `QUEUED_JOB_HARD_FAIL_THRESHOLD_MS` | `7200000` (2h) | Max time a job can sit `QUEUED` before it's force-failed |

Both are read at API startup. To change them, update `api/apphosting.yaml`
and redeploy.

## Why this exists

See `docs/superpowers/specs/2026-04-10-stuck-job-prevention-design.md` and
the incident writeup for job `uxBSYQvYB4JNoycuLSzz`, which sat stuck at
24/25 sims for ~12 hours because of a worker restart + Pub/Sub starvation.
```

- [ ] **Step 2: Commit**

```bash
git add docs/STALE_SWEEPER.md
git commit -m "docs: add stale-sweeper ops documentation"
```

---

## Task 9: Full verification

- [ ] **Step 1: Run the full unit test suite**

Run: `npm run test:unit --prefix api`
Expected: All tests pass.

- [ ] **Step 2: Run the full API lint**

Run: `npm run lint --prefix api`
Expected: No errors.

- [ ] **Step 3: Run the frontend lint (no frontend changes but CI runs it)**

Run: `npm run lint --prefix frontend`
Expected: No errors.

- [ ] **Step 4: Run the frontend build**

Run: `npm run build --prefix frontend`
Expected: Build succeeds.

- [ ] **Step 5: Run the API build**

Run: `npm run build --prefix api`
Expected: Build succeeds.

---

## Task 10: Create pull request

- [ ] **Step 1: Push the branch**

```bash
git push -u origin <branch-name>
```

- [ ] **Step 2: Create the PR**

Use `gh pr create` with the conventional PR template. Target `main`.

- [ ] **Step 3: Note the PR URL for the reviewer**

---

## Out of scope — not in this plan

- Automating the Cloud Scheduler job creation (documented only).
- Frontend changes (none).
- Worker changes (none).
- Sentry alert rule for sweeper errors (the existing catch-all Error Spike alert covers it).
