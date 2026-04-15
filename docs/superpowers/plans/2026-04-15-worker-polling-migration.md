# Worker Polling Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the worker's Pub/Sub subscription with a per-simulation HTTP polling claim, so the worker needs no GCP auth for job transport and has one uniform code path in local and GCP modes.

**Architecture:** Today, GCP-mode workers subscribe to Pub/Sub for per-sim tasks; local-mode workers poll `GET /api/jobs/next` for whole jobs. A single bad auth event on Apr 12 silently killed the subscription stream and sent the fleet offline for three days. We replace the split: both modes now call a new `GET /api/jobs/claim-sim` that atomically flips the oldest PENDING sim of the oldest active job to RUNNING. Firestore remains the authoritative work queue; dead-worker recovery via the existing heartbeat + `recoverStaleSimulations` paths is unchanged (just the Pub/Sub republish step is dropped — resetting to PENDING is enough because the next poll picks it up).

**Tech Stack:** Next.js 15 (API), Firestore/SQLite via factory pattern, node-fetch (worker), `tsx` for API tests.

---

## Why (Context for the executor)

- Worker talks to API via `WORKER_SECRET`. In polling mode it needs zero GCP credentials. This removes the entire failure class that just burned us.
- Dead-worker recovery already works via heartbeat (`getActiveWorkers(120_000)`) + `recoverStaleSimulations` (Case 3) + `stale-sweeper`. None of that depends on Pub/Sub.
- Per-sim claim preserves cross-worker within-job parallelism (what Pub/Sub's competing consumers gave us). Whole-job claim would regress this.
- Coverage jobs today get "created then delivered via Pub/Sub." After this change, the coverage job's sims just sit PENDING like any other job and the next poll picks them up.
- CLAUDE.md says: no backward-compatibility shims, don't preserve dead code.

## Non-goals

- Don't rework heartbeat, sweeper, or Cloud Tasks.
- Don't touch the simulation container itself.
- Don't change the log-upload path.
- Don't redesign worker status reporting (`PATCH /api/jobs/:id/simulations/:simId` stays).

## File inventory

**Create:**
- `api/app/api/jobs/claim-sim/route.ts` — new polling endpoint.
- `api/lib/claim-sim.test.ts` — unit tests for the new store method (SQLite path).

**Modify:**
- `api/lib/firestore-job-store.ts` — add `claimNextSim()`.
- `api/lib/job-store.ts` — add `claimNextSim()` for SQLite.
- `api/lib/job-store-factory.ts` — export `claimNextSim`; drop the two Pub/Sub imports in `recoverStaleSimulations` and `recoverStaleQueuedJob`; simplify recovery to "reset to PENDING, trust polling."
- `api/app/api/jobs/route.ts` — remove `publishSimulationTasks` call on job creation.
- `api/app/api/coverage/next-job/route.ts` — remove `publishSimulationTasks` call.
- `worker/src/worker.ts` — delete Pub/Sub branch, `handleMessage`, `Semaphore` stays, unify around the polling loop with per-sim claim.
- `worker/src/types.ts` — drop `SimulationTaskMessage`, `JobCreatedMessage` imports if unused elsewhere.
- `worker/src/worker-api.ts` — drop `pubsub` liveness field from healthz.
- `worker/docker-compose.yml` — make SA key mount optional (it's only needed for Secret Manager config loading, which is graceful-fallback); add comment.
- `api/apphosting.yaml` — remove `PUBSUB_TOPIC` env (no longer referenced).
- `DATA_FLOW.md` — update the "job created → work dispatch" section.

**Delete:**
- `api/lib/pubsub.ts` — only `publishJobCreated` / `publishSimulationTasks` / topic helpers lived here; all callers are removed.
- `worker/src/types.ts` — `SimulationTaskMessage` / `JobCreatedMessage` interfaces if only used by the Pub/Sub handler.

**Leave alone:**
- `api/lib/cloud-tasks.ts` (Cloud Tasks — unrelated, used by sweeper).
- `api/lib/stale-sweeper.ts` (still valuable, catches hard-cancel cases).
- `api/app/api/jobs/next/route.ts` — whole-job claim endpoint, still used in SOME worker paths? Verify during Task 9 and delete if unreferenced after the worker rewrite.
- Heartbeat + worker-store logic.

---

## Tasks

### Task 1: Add `claimNextSim` signature to the factory

**Files:**
- Modify: `api/lib/job-store-factory.ts`

- [ ] **Step 1: Define the return type and factory wrapper**

Add this after `claimNextJob` (around line 190). The type mirrors what the worker needs to start processing a sim — plus the job it belongs to so the worker can fetch deck data via the existing endpoint:

```ts
export interface ClaimedSim {
  jobId: string;
  simId: string;
  simIndex: number;
}

export async function claimNextSim(
  workerId: string,
  workerName: string,
): Promise<ClaimedSim | null> {
  if (USE_FIRESTORE) {
    return firestoreStore.claimNextSim(workerId, workerName);
  }
  return (await sqliteStore()).claimNextSim(workerId, workerName) ?? null;
}
```

- [ ] **Step 2: Commit the factory stub so later tasks can import it**

```bash
git add api/lib/job-store-factory.ts
git commit -m "feat(api): add claimNextSim factory signature (stubbed)"
```

Note: the implementations land in Tasks 2 and 3; at this point the call will throw `TypeError` (no function yet). That's fine — the failing test in Task 2/3 will drive the implementation.

---

### Task 2: Implement `claimNextSim` for SQLite (TDD)

**Files:**
- Create: `api/lib/claim-sim.test.ts`
- Modify: `api/lib/job-store.ts`

- [ ] **Step 1: Write the failing test**

```ts
// api/lib/claim-sim.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as jobStore from './job-store';
import { resetDbForTest } from './db';

test('claimNextSim: returns null when no active jobs exist', () => {
  resetDbForTest();
  const claimed = jobStore.claimNextSim('worker-1', 'Worker 1');
  assert.equal(claimed, null);
});

test('claimNextSim: claims oldest PENDING sim of oldest active job', () => {
  resetDbForTest();
  const job = jobStore.createJob(
    [{ name: 'a', dck: '' }, { name: 'b', dck: '' }, { name: 'c', dck: '' }, { name: 'd', dck: '' }],
    4,
  );
  jobStore.initializeSimulations(job.id, 2);

  const first = jobStore.claimNextSim('worker-1', 'Worker 1');
  assert.deepEqual(first, { jobId: job.id, simId: 'sim_000', simIndex: 0 });

  const second = jobStore.claimNextSim('worker-1', 'Worker 1');
  assert.deepEqual(second, { jobId: job.id, simId: 'sim_001', simIndex: 1 });

  const third = jobStore.claimNextSim('worker-1', 'Worker 1');
  assert.equal(third, null);
});

test('claimNextSim: flips job QUEUED → RUNNING on first claim', () => {
  resetDbForTest();
  const job = jobStore.createJob(
    [{ name: 'a', dck: '' }, { name: 'b', dck: '' }, { name: 'c', dck: '' }, { name: 'd', dck: '' }],
    4,
  );
  jobStore.initializeSimulations(job.id, 1);
  assert.equal(jobStore.getJob(job.id)!.status, 'QUEUED');

  jobStore.claimNextSim('worker-1', 'Worker 1');

  const after = jobStore.getJob(job.id)!;
  assert.equal(after.status, 'RUNNING');
  assert.equal(after.workerId, 'worker-1');
});

test('claimNextSim: sets sim RUNNING with workerId + startedAt', () => {
  resetDbForTest();
  const job = jobStore.createJob(
    [{ name: 'a', dck: '' }, { name: 'b', dck: '' }, { name: 'c', dck: '' }, { name: 'd', dck: '' }],
    4,
  );
  jobStore.initializeSimulations(job.id, 1);

  jobStore.claimNextSim('worker-1', 'Worker 1');

  const sim = jobStore.getSimulationStatus(job.id, 'sim_000')!;
  assert.equal(sim.state, 'RUNNING');
  assert.equal(sim.workerId, 'worker-1');
  assert.equal(sim.workerName, 'Worker 1');
  assert.ok(sim.startedAt);
});

test('claimNextSim: skips terminal jobs', () => {
  resetDbForTest();
  const job = jobStore.createJob(
    [{ name: 'a', dck: '' }, { name: 'b', dck: '' }, { name: 'c', dck: '' }, { name: 'd', dck: '' }],
    4,
  );
  jobStore.initializeSimulations(job.id, 1);
  jobStore.setJobFailed(job.id, 'manual');

  const claimed = jobStore.claimNextSim('worker-1', 'Worker 1');
  assert.equal(claimed, null);
});
```

- [ ] **Step 2: Run the test — expect it to fail**

```bash
npx --prefix api tsx --test api/lib/claim-sim.test.ts
```

Expected: `TypeError: jobStore.claimNextSim is not a function`.

- [ ] **Step 3: Implement `claimNextSim` in `api/lib/job-store.ts`**

Add after `claimNextJob` (around line 262). Single transaction that:
1. Picks the oldest job in status QUEUED or RUNNING with at least one PENDING sim.
2. Picks its lowest-index PENDING sim.
3. Flips that sim to RUNNING with workerId/startedAt.
4. If the job is QUEUED, flips it to RUNNING (same worker).

```ts
export function claimNextSim(
  workerId: string,
  workerName: string,
): { jobId: string; simId: string; simIndex: number } | undefined {
  const db = getDb();
  const nowIso = new Date().toISOString();

  const tx = db.transaction(() => {
    const row = db
      .prepare(
        `SELECT s.job_id AS job_id, s.sim_id AS sim_id, s.idx AS idx, j.status AS job_status
         FROM simulations s
         JOIN jobs j ON j.id = s.job_id
         WHERE s.state = 'PENDING' AND j.status IN ('QUEUED', 'RUNNING')
         ORDER BY j.created_at ASC, s.idx ASC
         LIMIT 1`,
      )
      .get() as { job_id: string; sim_id: string; idx: number; job_status: string } | undefined;

    if (!row) return undefined;

    const simUpdate = db
      .prepare(
        `UPDATE simulations
         SET state = 'RUNNING', worker_id = ?, worker_name = ?, started_at = ?
         WHERE job_id = ? AND sim_id = ? AND state = 'PENDING'`,
      )
      .run(workerId, workerName, nowIso, row.job_id, row.sim_id);

    if (simUpdate.changes === 0) return undefined; // Lost race

    if (row.job_status === 'QUEUED') {
      db.prepare(
        `UPDATE jobs SET status = 'RUNNING', started_at = COALESCE(started_at, ?), worker_id = COALESCE(worker_id, ?), worker_name = COALESCE(worker_name, ?), claimed_at = COALESCE(claimed_at, ?) WHERE id = ? AND status = 'QUEUED'`,
      ).run(nowIso, workerId, workerName, nowIso, row.job_id);
    }

    return { jobId: row.job_id, simId: row.sim_id, simIndex: row.idx };
  });

  return tx();
}
```

- [ ] **Step 4: Run the test — expect it to pass**

```bash
npx --prefix api tsx --test api/lib/claim-sim.test.ts
```

Expected: 5/5 pass.

- [ ] **Step 5: Commit**

```bash
git add api/lib/claim-sim.test.ts api/lib/job-store.ts
git commit -m "feat(api): claimNextSim for SQLite"
```

---

### Task 3: Implement `claimNextSim` for Firestore

**Files:**
- Modify: `api/lib/firestore-job-store.ts`

Firestore can't join across subcollections cheaply. The query plan:
1. Fetch up to N oldest jobs where `status IN ('QUEUED', 'RUNNING')` AND `completedSimCount < totalSimCount`.
2. For the first such job, in a transaction:
   - Query its simulations subcollection for the lowest-index PENDING doc.
   - Conditionally flip it to RUNNING.
   - If the job doc says QUEUED, flip it to RUNNING in the same transaction.
3. If the transaction loses (sim changed state), try the next job.

- [ ] **Step 1: Add the implementation**

```ts
// Add near the bottom of firestore-job-store.ts, after claimNextJob.

export async function claimNextSim(
  workerId: string,
  workerName: string,
): Promise<{ jobId: string; simId: string; simIndex: number } | null> {
  // 1. Find up to 10 candidate active jobs with at least one unfinished sim.
  const candidates = await jobsCollection
    .where('status', 'in', ['QUEUED', 'RUNNING'])
    .orderBy('createdAt', 'asc')
    .limit(10)
    .get();

  for (const jobDoc of candidates.docs) {
    const jobData = jobDoc.data();
    const completed = jobData.completedSimCount ?? 0;
    const total = jobData.totalSimCount ?? 0;
    if (total > 0 && completed >= total) continue;

    // 2. Find the lowest-index PENDING sim for this job.
    const pending = await simulationsCollection(jobDoc.id)
      .where('state', '==', 'PENDING')
      .orderBy('index', 'asc')
      .limit(1)
      .get();
    if (pending.empty) continue;

    const simDoc = pending.docs[0];

    // 3. Transaction: claim the sim + (if needed) flip the job to RUNNING.
    const claimed = await firestore.runTransaction(async (tx) => {
      const freshSim = await tx.get(simDoc.ref);
      if (!freshSim.exists) return null;
      if (freshSim.data()?.state !== 'PENDING') return null;

      const freshJob = await tx.get(jobDoc.ref);
      if (!freshJob.exists) return null;
      const jobStatus = freshJob.data()?.status;
      if (jobStatus !== 'QUEUED' && jobStatus !== 'RUNNING') return null;

      tx.update(simDoc.ref, {
        state: 'RUNNING',
        workerId,
        workerName,
        startedAt: new Date().toISOString(),
      });

      if (jobStatus === 'QUEUED') {
        tx.update(jobDoc.ref, {
          status: 'RUNNING',
          startedAt: FieldValue.serverTimestamp(),
          claimedAt: FieldValue.serverTimestamp(),
          workerId,
          workerName,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      return {
        jobId: jobDoc.id,
        simId: simDoc.id,
        simIndex: (freshSim.data()?.index ?? 0) as number,
      };
    });

    if (claimed) return claimed;
    // else lost the race, try next candidate
  }

  return null;
}
```

- [ ] **Step 2: Type-check**

```bash
npm run lint --prefix api
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add api/lib/firestore-job-store.ts
git commit -m "feat(api): claimNextSim for Firestore"
```

---

### Task 4: Add the `GET /api/jobs/claim-sim` endpoint

**Files:**
- Create: `api/app/api/jobs/claim-sim/route.ts`

- [ ] **Step 1: Implement the route**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { isWorkerRequest } from '@/lib/auth';
import { claimNextSim } from '@/lib/job-store-factory';
import { errorResponse } from '@/lib/api-response';

/**
 * GET /api/jobs/claim-sim — Atomically claim the next PENDING simulation.
 *
 * Worker polling entry point. Replaces the Pub/Sub subscription that
 * previously delivered SimulationTaskMessage one-per-sim.
 *
 * Query params:
 *   workerId (required)   — identifies the claimer for heartbeat / reclaim
 *   workerName (required) — display name, surfaced on the job detail UI
 *
 * Returns 200 { jobId, simId, simIndex } or 204 when no work is available.
 * Auth: X-Worker-Secret (same as the old /api/jobs/next).
 */
export async function GET(request: NextRequest) {
  if (!isWorkerRequest(request)) {
    return errorResponse('Unauthorized', 401);
  }

  const url = new URL(request.url);
  const workerId = url.searchParams.get('workerId');
  const workerName = url.searchParams.get('workerName');
  if (!workerId || !workerName) {
    return errorResponse('workerId and workerName are required', 400);
  }

  try {
    const claimed = await claimNextSim(workerId, workerName);
    if (!claimed) return new NextResponse(null, { status: 204 });
    return NextResponse.json(claimed);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Failed to claim sim', 500);
  }
}
```

- [ ] **Step 2: Type-check**

```bash
npm run lint --prefix api
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add api/app/api/jobs/claim-sim/route.ts
git commit -m "feat(api): GET /api/jobs/claim-sim endpoint"
```

---

### Task 5: Simplify `recoverStaleSimulations` — drop Pub/Sub republish

**Files:**
- Modify: `api/lib/job-store-factory.ts`

Rationale: Case 1 ("PENDING stuck >5 min → republish") was covering for lost Pub/Sub messages. In the polling model, Firestore IS the queue; a sim that's PENDING will be picked up on the next `claimNextSim`. Cases 2 and 3 (reset to PENDING after timeout or dead worker) are still correct — just drop the Pub/Sub publish step. Case 4 becomes trivial: reset FAILED sims to PENDING, workers will find them.

- [ ] **Step 1: Rewrite `recoverStaleSimulations` in `api/lib/job-store-factory.ts:334`**

Delete the `simsToRepublish` array, the dynamic `./pubsub` import, and the `topic.publishMessage` promise chain. Replace the whole body (lines 334–448) with the simplified version below. Local-mode recovery (`recoverStaleSimulationsLocal`) is already Pub/Sub-free — keep it.

```ts
async function recoverStaleSimulations(
  jobId: string,
  job: Job,
  activeWorkers: WorkerInfo[],
): Promise<boolean> {
  if (!USE_FIRESTORE) {
    return recoverStaleSimulationsLocal(jobId, job, activeWorkers);
  }

  const sims = await getSimulationStatuses(jobId);
  if (sims.length === 0) return false;

  const now = Date.now();
  const activeWorkerIds = new Set(activeWorkers.map((w) => w.workerId));
  let recovered = false;

  for (const sim of sims) {
    // Case 1: RUNNING sim stuck for >2.5 hours — container timed out.
    if (sim.state === 'RUNNING' && sim.startedAt) {
      const runningForMs = now - new Date(sim.startedAt).getTime();
      if (runningForMs > STALE_RUNNING_THRESHOLD_MS) {
        const updated = await conditionalUpdateSimulationStatus(jobId, sim.simId, ['RUNNING'], {
          state: 'PENDING',
          errorMessage: `Reset after ${Math.round(runningForMs / 60000)}m without completion`,
          startedAt: undefined,
          workerId: undefined,
          workerName: undefined,
        });
        if (updated) {
          recoveryLog.info('Sim RUNNING too long, reset to PENDING', { jobId, simId: sim.simId, runningMin: Math.round(runningForMs / 60000) });
          recovered = true;
        }
      }
    }

    // Case 2: RUNNING sim whose worker is dead.
    if (sim.state === 'RUNNING' && sim.workerId && !activeWorkerIds.has(sim.workerId)) {
      const updated = await conditionalUpdateSimulationStatus(jobId, sim.simId, ['RUNNING'], {
        state: 'PENDING',
        errorMessage: 'Worker lost connection; reset for reclaim',
        startedAt: undefined,
        workerId: undefined,
        workerName: undefined,
      });
      if (updated) {
        recoveryLog.info('Sim worker dead, reset to PENDING', { jobId, simId: sim.simId, deadWorker: sim.workerId });
        recovered = true;
      }
    }

    // Case 3: FAILED sim — let it retry (reset to PENDING unconditionally).
    if (sim.state === 'FAILED') {
      const updated = await conditionalUpdateSimulationStatus(jobId, sim.simId, ['FAILED'], {
        state: 'PENDING',
        errorMessage: undefined,
        startedAt: undefined,
      });
      if (updated) {
        recoveryLog.info('Sim FAILED, reset to PENDING for retry', { jobId, simId: sim.simId });
        recovered = true;
      }
    }
  }

  if (!recovered) {
    const allDone = sims.every((s) => s.state === 'COMPLETED' || s.state === 'CANCELLED');
    if (allDone) {
      const needsRetrigger = job.status === 'RUNNING' || job.needsAggregation === true;
      if (needsRetrigger) {
        aggregateJobResults(jobId).catch((err) => {
          recoveryLog.error('Aggregation failed', { jobId, error: err instanceof Error ? err.message : String(err) });
          Sentry.captureException(err, { tags: { component: 'recovery-aggregation', jobId } });
        });
      }
    }
  }

  return recovered;
}
```

Important: check that `conditionalUpdateSimulationStatus` in both stores accepts `undefined` as a value to clear a field. In the Firestore implementation, replace `undefined` with `FieldValue.delete()` — look at `updateSimulationStatus` for the existing pattern. In SQLite, plain SQL NULL is sufficient. If the current helper doesn't support clearing, extend it **minimally** — no shotgun changes.

- [ ] **Step 2: Look at `recoverStaleQueuedJob` (lines ~541–590)**

It currently re-publishes to Pub/Sub when a job has been QUEUED >2 min. In polling, we don't need this — workers will find QUEUED jobs on their next poll. Delete the re-publish body; keep the function signature but have it just return false. Or: delete the function entirely and remove its caller. Prefer the latter.

Search for `recoverStaleQueuedJob` callers with Grep and delete them. If it's only used from `recoverStaleJob`, remove the call site too.

- [ ] **Step 3: Type-check**

```bash
npm run lint --prefix api
npm run test:unit --prefix api
```

Expected: no lint errors, unit tests pass (stale-sweeper tests may need updates — see Task 12).

- [ ] **Step 4: Commit**

```bash
git add api/lib/job-store-factory.ts
git commit -m "refactor(api): drop Pub/Sub republish from stale-sim recovery"
```

---

### Task 6: Stop publishing Pub/Sub on job creation

**Files:**
- Modify: `api/app/api/jobs/route.ts`
- Modify: `api/app/api/coverage/next-job/route.ts`

- [ ] **Step 1: Remove publish call from `api/app/api/jobs/route.ts`**

Delete the import `import { publishSimulationTasks } from '@/lib/pubsub';` and the `if (isGcpMode()) { ... publishSimulationTasks ... }` block around line 194–203. Replace with a single-branch notify:

```ts
    // Both modes: workers pick up sims via GET /api/jobs/claim-sim polling.
    // In local mode, push-notify active workers for near-instant wake-up.
    if (!isGcpMode()) {
      pushToAllWorkers('/notify', {}).catch(err =>
        console.warn('[Worker Push] Notify failed:', err instanceof Error ? err.message : err)
      );
    }
    // GCP mode: workers are expected to poll every POLL_INTERVAL_MS (~3s).
    // Recovery Cloud Task still scheduled below for belt-and-suspenders.
    scheduleRecoveryCheck(job.id, 600).catch(err =>
      console.warn('[Recovery] Failed to schedule check:', err instanceof Error ? err.message : err)
    );
```

(Lift `scheduleRecoveryCheck` out of the `isGcpMode()` block — local mode doesn't have Cloud Tasks, so wrap it so it's only scheduled in GCP mode. Check `cloud-tasks.ts` to confirm the no-op behavior.)

- [ ] **Step 2: Same treatment in `api/app/api/coverage/next-job/route.ts`**

Remove the `publishSimulationTasks` import and the publish block around line 58. Coverage jobs just leave sims PENDING; workers pick them up.

- [ ] **Step 3: Type-check**

```bash
npm run lint --prefix api
```

- [ ] **Step 4: Commit**

```bash
git add api/app/api/jobs/route.ts api/app/api/coverage/next-job/route.ts
git commit -m "refactor(api): stop publishing Pub/Sub on job creation"
```

---

### Task 7: Delete `api/lib/pubsub.ts`

**Files:**
- Delete: `api/lib/pubsub.ts`

- [ ] **Step 1: Verify no imports remain**

```bash
```
Then search:
- `grep -r "from '@/lib/pubsub'" api/` → expect empty
- `grep -r "from './pubsub'" api/` → expect empty
- `grep -r 'require.*pubsub' api/` → expect empty

If anything remains, fix the caller first (don't keep stub exports).

- [ ] **Step 2: Delete the file**

```bash
git rm api/lib/pubsub.ts
```

- [ ] **Step 3: Remove `@google-cloud/pubsub` from `api/package.json`**

Only remove if no remaining code imports it (the coverage-service, the queue, anything).

```bash
grep -r "@google-cloud/pubsub" api/ --include='*.ts' --include='*.tsx'
```

If empty, uninstall:

```bash
npm uninstall @google-cloud/pubsub --prefix api
```

- [ ] **Step 4: Type-check and commit**

```bash
npm run lint --prefix api
git add api/lib/pubsub.ts api/package.json api/package-lock.json
git commit -m "chore(api): remove unused @google-cloud/pubsub"
```

---

### Task 8: Rewrite the worker main loop for per-sim polling

**Files:**
- Modify: `worker/src/worker.ts`

- [ ] **Step 1: Replace `pollForJobs` with `pollForSims`**

Locate `pollForJobs` (around line 910). Replace the entire function:

```ts
async function pollForSims(): Promise<void> {
  const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '3000', 10);
  const IDLE_POLL_INTERVAL_MS = parseInt(process.env.IDLE_POLL_INTERVAL_MS || '10000', 10);

  console.log(`Polling for sims at ${getApiUrl()}/api/jobs/claim-sim every ${POLL_INTERVAL_MS}ms (capacity=${localCapacity})...`);

  while (!isShuttingDown) {
    if (isDraining) {
      await waitForNotifyOrTimeout(IDLE_POLL_INTERVAL_MS);
      continue;
    }

    // Block until we have a slot — no point claiming work we can't run.
    await simSemaphore!.acquire();

    let claimed: { jobId: string; simId: string; simIndex: number } | null = null;
    try {
      const url = new URL(`${getApiUrl()}/api/jobs/claim-sim`);
      url.searchParams.set('workerId', currentWorkerId);
      url.searchParams.set('workerName', currentWorkerName);
      const res = await fetch(url.toString(), {
        headers: getApiHeaders(),
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });
      if (res.status === 200) {
        claimed = (await res.json()) as { jobId: string; simId: string; simIndex: number };
      } else if (res.status === 204) {
        claimed = null;
      } else {
        console.warn(`claim-sim unexpected status ${res.status}`);
      }
    } catch (error) {
      if (error instanceof Error && error.name !== 'TimeoutError') {
        console.error('Polling error:', error);
        captureWorkerException(error, { component: 'polling-loop', workerId: currentWorkerId });
      }
    }

    if (!claimed) {
      simSemaphore!.release();
      const coverageCreated = await requestCoverageJob();
      if (coverageCreated) continue; // Fast path — try to claim the new coverage sims immediately
      await waitForNotifyOrTimeout(IDLE_POLL_INTERVAL_MS);
      continue;
    }

    const { jobId, simId, simIndex } = claimed;
    // Fire-and-forget — release semaphore in processSimulation's finally path.
    processSimulation(jobId, simId, simIndex)
      .catch(async (error) => {
        console.error(`Error processing simulation ${simId} for job ${jobId}:`, error);
        await reportSimulationStatus(jobId, simId, {
          state: 'FAILED',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
        });
      })
      .finally(() => simSemaphore!.release());
  }
}
```

Important: `processSimulation` currently calls `reportSimulationStatus(..., { state: 'RUNNING' })` at the top. Since `claimNextSim` already flipped the sim to RUNNING, this PATCH is now a no-op — check `api/app/api/jobs/[id]/simulations/[simId]/route.ts` transition guard (`canSimTransition('RUNNING','RUNNING')`). If it returns `updated: false` with `reason: 'invalid_transition'`, the worker will skip the sim — bad. Either:
   - Remove the RUNNING PATCH from `processSimulationInternal` (sim is already RUNNING), OR
   - Make the state-machine accept RUNNING→RUNNING as a heartbeat-style idempotent update.

Pick **remove the PATCH**. The workerId/workerName on the sim is set by `claimNextSim` now.

- [ ] **Step 2: Remove the RUNNING PATCH in `processSimulationInternal`**

In `worker/src/worker.ts` around lines 381–391, delete the `activeSimCount++; const accepted = await reportSimulationStatus(...{ state: 'RUNNING', ...}); if (!accepted) { ... return; }` block. Replace with:

```ts
activeSimCount++;
```

The "already terminal" check is still useful but now happens via `fetchJob` up-front; keep that.

- [ ] **Step 3: Delete the Pub/Sub branch in `main()`**

Find the `if (usePubSub) { ... } else { await pollForJobs(); }` block (around line 1095–1144). Replace with:

```ts
console.log('Worker is running in polling mode.');
await pollForSims();
```

Remove `usePubSub`, `subscription`, `handleMessage`, `pubSubHealthy`, `lastPubSubError`, `PUBSUB_SUBSCRIPTION` env usage, and the dynamic `@google-cloud/pubsub` import.

- [ ] **Step 4: Remove Pub/Sub-related types if unused elsewhere**

```bash
grep -r "SimulationTaskMessage\|JobCreatedMessage" worker/src
```

If only `worker.ts` imports them, drop the imports + the interface definitions in `worker/src/types.ts`.

- [ ] **Step 5: Build and unit-test the worker**

```bash
npm run build --prefix worker
```

Expected: clean build.

- [ ] **Step 6: Commit**

```bash
git add worker/src/
git commit -m "refactor(worker): replace Pub/Sub subscription with per-sim polling"
```

---

### Task 9: Drop `/api/jobs/next` if unused; simplify `claimNextJob` plumbing

**Files:**
- Maybe delete: `api/app/api/jobs/next/route.ts`
- Maybe modify: `api/lib/job-store-factory.ts`, `api/lib/job-store.ts`, `api/lib/firestore-job-store.ts`

- [ ] **Step 1: Check usage**

```bash
grep -r "/api/jobs/next" worker/ api/ frontend/
grep -r "claimNextJob" api/ worker/
```

If the worker no longer hits `/api/jobs/next` after Task 8 and `claimNextJob` has no other callers, proceed. Otherwise leave alone.

- [ ] **Step 2: If unused, delete the endpoint and factory method**

```bash
git rm api/app/api/jobs/next/route.ts
```

Remove `claimNextJob` from `job-store-factory.ts`, `firestore-job-store.ts`, `job-store.ts`.

- [ ] **Step 3: Commit**

```bash
git add api/
git commit -m "chore(api): remove dead claimNextJob (whole-job claim) path"
```

---

### Task 10: Drop Pub/Sub liveness from worker healthz

**Files:**
- Modify: `worker/src/worker.ts`
- Modify: `worker/src/worker-api.ts` (if the healthz lives there)

- [ ] **Step 1: Simplify `getHealth` in `worker/src/worker.ts`**

Inside `startWorkerApi({ ... getHealth: ... })`, replace the body with:

```ts
getHealth: (): HealthStatus => ({ ok: true }),
```

- [ ] **Step 2: In `worker/src/worker-api.ts`, drop the `pubsub` field from `HealthStatus`**

Make it just `{ ok: boolean }`. Any callers that read `pubsub` — update or delete.

- [ ] **Step 3: Check the Dockerfile HEALTHCHECK**

Look at `worker/Dockerfile` (and `worker/docker-compose.yml`) for a HEALTHCHECK directive. If it curls `/healthz`, that keeps working (returns 200 as long as the HTTP server is up). Don't add any Pub/Sub probe.

- [ ] **Step 4: Commit**

```bash
git add worker/src/
git commit -m "refactor(worker): simplify healthz (no more Pub/Sub liveness)"
```

---

### Task 11: Strip SA-key dependency from docker-compose

**Files:**
- Modify: `worker/docker-compose.yml`
- Modify: `worker/docker-compose.local.yml` (if present)
- Modify: `worker/.env.example`

- [ ] **Step 1: Inspect the current mount**

The worker container mounts `sa.json` at `/secrets/sa.json` for GCP client auth. After this migration the only GCP library the worker imports is `@google-cloud/secret-manager` (optional config loader). If we drop that import too, the worker needs zero GCP credentials.

Confirm with:

```bash
grep -r "@google-cloud" worker/src
```

- [ ] **Step 2: Make Secret Manager usage explicit-opt-in OR remove it entirely**

Simpler: **remove `loadConfigFromSecretManager` entirely**. Config flows via env vars supplied by docker-compose. Less magic.

Delete the `loadConfigFromSecretManager` function in `worker/src/worker.ts` and the call site in `main()`. Remove `@google-cloud/secret-manager` from `worker/package.json`:

```bash
npm uninstall @google-cloud/secret-manager --prefix worker
```

- [ ] **Step 3: Remove the SA key mount from `worker/docker-compose.yml`**

Delete these lines:

```yaml
- GOOGLE_APPLICATION_CREDENTIALS=/secrets/sa.json
...
- ${SA_KEY_PATH:-${GOOGLE_APPLICATION_CREDENTIALS:-~/.config/gcloud/application_default_credentials.json}}:/secrets/sa.json:ro
```

Leave only `API_URL`, `WORKER_SECRET`, `WORKER_ID`, `WORKER_NAME`, `JOBS_DIR`, `SIMULATION_IMAGE`, poll/heartbeat intervals, and docker-socket mount.

- [ ] **Step 4: Update `worker/.env.example`**

Drop `PUBSUB_SUBSCRIPTION`, `GOOGLE_APPLICATION_CREDENTIALS`, and any GCP project vars unless actually used elsewhere. Document the minimum set:

```
API_URL=https://api--magic-bracket-simulator.us-central1.hosted.app
WORKER_SECRET=<from Secret Manager: worker-secret>
WORKER_NAME=my-laptop
POLL_INTERVAL_MS=3000
```

- [ ] **Step 5: Commit**

```bash
git add worker/ 
git commit -m "chore(worker): drop SA key and Secret Manager (API-only auth)"
```

---

### Task 12: Fix/remove stale tests

**Files:**
- Modify: `api/lib/stale-sweeper.test.ts` (likely breakage)
- Modify: any coverage-service tests that relied on Pub/Sub
- Modify: any integration test that mocked Pub/Sub

- [ ] **Step 1: Run the full unit suite**

```bash
npm run test:unit --prefix api
```

- [ ] **Step 2: For each failure, read the assertion and adapt**

Tests that assert "sim was republished to Pub/Sub" should assert "sim was reset to PENDING" instead. Tests that mock the Pub/Sub client should mock nothing (Pub/Sub is gone).

- [ ] **Step 3: Run integration + ingestion suites**

```bash
npm run test:integration --prefix api
npm run test:ingestion --prefix api
```

- [ ] **Step 4: Frontend build/lint sanity**

```bash
npm run lint --prefix frontend
npm run build --prefix frontend
```

- [ ] **Step 5: Commit**

```bash
git add api/ frontend/
git commit -m "test: update tests for polling-based sim dispatch"
```

---

### Task 13: Update DATA_FLOW.md

**Files:**
- Modify: `DATA_FLOW.md`

- [ ] **Step 1: Update the "job created → work dispatch" section**

Describe the new flow:
```
Client POST /api/jobs
  → createJob (Firestore/SQLite)
  → initializeSimulations (N PENDING sim docs)
  → (local mode only) pushToAllWorkers('/notify')
  → (GCP mode) scheduleRecoveryCheck at T+10min (Cloud Tasks)

Worker loop:
  acquire semaphore slot
  → GET /api/jobs/claim-sim?workerId=...&workerName=...
  → 200: conditional PENDING → RUNNING on oldest sim; job QUEUED → RUNNING if first claim
  → 204: sleep, request coverage job, loop

Worker crash recovery:
  heartbeat (every 60s)
  stale-sweeper (every 5min): any sim RUNNING under a dead workerId → reset PENDING
  next poll: claimed by another worker
```

Remove any remaining references to Pub/Sub / `SimulationTaskMessage` / "at-least-once delivery via Pub/Sub."

- [ ] **Step 2: Commit**

```bash
git add DATA_FLOW.md
git commit -m "docs: update DATA_FLOW.md for polling-based dispatch"
```

---

### Task 14: End-to-end local verification

- [ ] **Step 1: Run in LOCAL mode**

```bash
npm run dev:local
```

Open http://localhost:5173, submit a 4-sim job with any four precons. Confirm sims transition PENDING → RUNNING → COMPLETED and the job finishes.

- [ ] **Step 2: Kill the worker mid-sim**

While sims are RUNNING, `docker stop` the worker. Wait 2 minutes. Start it again. Confirm sims get reclaimed (sweeper resets dead-worker RUNNING → PENDING; worker polls and re-claims).

- [ ] **Step 3: Build + lint everything clean**

```bash
npm run install:all
npm run lint --prefix frontend
npm run lint --prefix api
npm run build --prefix api
npm run build --prefix frontend
npm run build --prefix worker
npm run test:unit --prefix api
```

All must pass — CI runs the same.

---

### Task 15: PR + merge

- [ ] **Step 1: Push branch**

```bash
git push -u origin simplify-worker-polling
```

- [ ] **Step 2: Open PR**

```bash
gh pr create --base main --title "refactor(worker): replace Pub/Sub with HTTP polling" --body "..."
```

PR body must include: summary bullets, the failure-mode that motivated this (Apr 12 subscription silent death), test plan checklist, and the Claude Code attribution.

- [ ] **Step 3: Wait for Claude + Gemini review bots**

Both post PR review comments automatically. Wait up to 30 minutes.

- [ ] **Step 4: Address review comments**

For each actionable comment, either fix (new commit, push) or respond with a reasoned disagreement. After pushing, wait for re-review.

- [ ] **Step 5: Merge**

Once both bots approve (or only nits remain, addressed), `gh pr merge --squash --delete-branch`.

- [ ] **Step 6: Verify deployment**

After App Hosting rollout completes:

```bash
curl -s https://api--magic-bracket-simulator.us-central1.hosted.app/api/health/workers
```

Expect 1 online worker (once the Mac worker is restarted with the new image — local development note; the running prod worker needs restart to pick up the new code once docker-pull happens via watchtower).

---

## Rollback

If something breaks in prod, revert the merge commit (`gh pr revert`). Do NOT try to patch forward — the Pub/Sub removal is isolated and reverting restores the previous (known-broken-but-recoverable) state, and the Mac worker's sa.json still works with the old code path.

## What this plan does NOT do

- Doesn't add new failure-mode monitoring. (Follow-up: Cloud Monitoring alert on "no sim claims in last 30min while QUEUED jobs exist.")
- Doesn't rotate the existing SA key. Separate operational task.
- Doesn't migrate coverage-service's remaining Pub/Sub deps, if any. Task 12 surfaces them.
