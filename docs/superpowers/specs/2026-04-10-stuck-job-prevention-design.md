# Stuck Job Prevention — Scheduled Sweeper Design

**Date:** 2026-04-10
**Status:** Approved
**Problem:** Jobs can get stuck indefinitely in `RUNNING` state when (1) a worker restart orphans a simulation before stale detection fires, and (2) Pub/Sub starvation prevents the re-published message from being delivered. Recovery is currently GET-triggered, so a job nobody checks on sits stuck forever.

Concrete incident: job `uxBSYQvYB4JNoycuLSzz` sat at 24 / 25 sims for ~12 hours because `sim_003` was orphaned by a worker restart, then the re-publish competed with a newer job's 24 backlogged messages and lost.

## Goals

1. Jobs eventually reach a terminal state (`COMPLETED` / `FAILED` / `CANCELLED`) without any manual intervention.
2. Recovery runs on a fixed schedule, independent of whether anyone is viewing the job.
3. A hard upper bound exists on how long any one simulation can block a job from finishing — the "eventually" in "eventually resolved".
4. Partial results are preserved: if some sims complete but one is stuck, cancelling the stuck sim should aggregate the completed ones rather than throwing the whole job away.
5. Stay within GCP free tier.

## Non-goals

- Fixing the Pub/Sub starvation at its source (worker synchronous-pull rewrite). Deferred — the sweeper is sufficient as a safety net.
- Graceful worker shutdown handling. Out of scope.
- Changes to how new jobs are published or how sims are normally processed.

## Design Decisions

| Decision | Value | Rationale |
|----------|-------|-----------|
| Sweeper trigger | Cloud Scheduler → HTTP POST | Free tier (3 jobs/mo), already GCP-native, survives worker/API restarts |
| Sweep cadence | Every 15 minutes | Well within Firestore free quota; fast enough given 2h sim cap |
| Absolute sim lifetime cap | 2 hours from `job.startedAt` (or `job.createdAt` if unstarted) | Matches the existing `STALE_RUNNING_THRESHOLD_MS` envelope |
| Absolute QUEUED-job cap | 2 hours from `job.createdAt` | If no worker claims it in 2h, something is wrong |
| Auth | Reuse `WORKER_SECRET` via `X-Worker-Secret` header | Already in Secret Manager, matches `api/app/api/admin/pull-image/route.ts` pattern |
| When stuck sim is cancelled | Set state `CANCELLED` (not `FAILED`) | The existing recovery logic aggregates when every sim is `COMPLETED` or `CANCELLED`; `FAILED` would trigger a retry loop |
| Per-job failure isolation | One try/catch per job inside the sweep loop | A single broken job can't halt the whole sweep |
| Observability | Sentry breadcrumbs + `component: 'stale-sweeper'` tag on captured errors | Matches existing Sentry patterns in `api/lib/job-store-factory.ts` |

## Architecture

```
┌─────────────────┐   15-min HTTP cron    ┌─────────────────────────────────┐
│ Cloud Scheduler │ ─────────────────────▶│ POST /api/admin/sweep-stale-jobs│
│    (1 job)      │  X-Worker-Secret hdr  │         (Next.js route)         │
└─────────────────┘                       └────────────┬────────────────────┘
                                                       │
                                                       ▼
                                         jobStore.listActiveJobs()
                                                       │
                                                       ▼
                             ┌────────────────────────────────────────────┐
                             │ for each job (isolated try/catch):         │
                             │   1. QUEUED >2h?  → setJobFailed           │
                             │   2. RUNNING >2h? → hardCancelStaleSims    │
                             │   3. recoverStaleJob(jobId)  (existing)    │
                             └────────────────────────────────────────────┘
```

Step 3 (existing logic) is what ultimately makes the job transition to `COMPLETED`. When the sweeper cancels the last stuck sim, `recoverStaleJob` → `recoverStaleSimulations` will see that every sim is now `COMPLETED` or `CANCELLED` and trigger `aggregateJobResults`. This is exactly the path we used manually to unstick `uxBSYQvYB4JNoycuLSzz`, so it is known to work.

## Changes

### 1. New module: `api/lib/stale-sweeper.ts`

Pure orchestration logic for the sweep. Keeps the route handler thin and makes the sweep unit-testable via a pure predicate.

```typescript
// ── Exported constants ──
export const SIM_HARD_CANCEL_THRESHOLD_MS =
  parseInt(process.env.SIM_HARD_CANCEL_THRESHOLD_MS ?? '7200000', 10); // 2h
export const QUEUED_JOB_HARD_FAIL_THRESHOLD_MS =
  parseInt(process.env.QUEUED_JOB_HARD_FAIL_THRESHOLD_MS ?? '7200000', 10); // 2h

// ── Pure predicate (unit-testable) ──
export function shouldHardCancelSim(
  sim: SimulationStatus,
  jobBaselineMs: number,
  nowMs: number,
  thresholdMs = SIM_HARD_CANCEL_THRESHOLD_MS
): boolean {
  if (sim.state === 'COMPLETED' || sim.state === 'CANCELLED') return false;
  return nowMs - jobBaselineMs > thresholdMs;
}

// ── Side-effecting helpers ──
export async function hardCancelStaleSimsForJob(
  job: Job,
  nowMs: number
): Promise<number> { /* ... */ }

export async function hardFailStaleQueuedJob(
  job: Job,
  nowMs: number
): Promise<boolean> { /* ... */ }

// ── Top-level entrypoint ──
export interface SweepResult {
  scanned: number;
  simsCancelled: number;
  jobsFailed: number;
  recoveriesTriggered: number;
  errors: { jobId: string; error: string }[];
}
export async function sweepStaleJobs(): Promise<SweepResult> { /* ... */ }
```

`shouldHardCancelSim` takes a "job baseline" (`startedAt ?? createdAt`) so every sim in a job shares the same 2h clock. This gives simple, user-legible semantics: "no sim from this job can block completion more than 2h after the job started."

`hardCancelStaleSimsForJob` uses `conditionalUpdateSimulationStatus(jobId, simId, ['PENDING','RUNNING','FAILED'], {state: 'CANCELLED', ...})` so a race with a worker completing the sim at the last second is safe — the conditional write rejects the cancel if the sim has already transitioned to `COMPLETED`.

`sweepStaleJobs` iterates `jobStore.listActiveJobs()` (which already filters on `status IN (QUEUED, RUNNING)`) and wraps each job in its own try/catch. Errors go to Sentry with a `component: 'stale-sweeper'` tag and are also collected into the returned `SweepResult.errors` for the HTTP response.

### 2. New endpoint: `api/app/api/admin/sweep-stale-jobs/route.ts`

```typescript
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
  } catch (err) {
    console.error('[StaleSweeper] Error:', err);
    return errorResponse(err instanceof Error ? err.message : 'Sweep failed', 500);
  }
}
```

Follows the existing `api/app/api/admin/pull-image/route.ts` auth pattern. Local mode bypasses the secret check so the endpoint is callable in dev without setup.

### 3. Unit tests: `api/lib/stale-sweeper.test.ts`

Tests focus on the pure predicate `shouldHardCancelSim`, since the side-effecting layer is a thin wrapper over already-tested primitives (`conditionalUpdateSimulationStatus`, `recoverStaleJob`).

Cases:
- `COMPLETED` sim is never cancelled regardless of age
- `CANCELLED` sim is never cancelled (idempotent)
- `RUNNING` sim younger than 2h is not cancelled
- `RUNNING` sim older than 2h is cancelled
- `PENDING` sim older than 2h is cancelled
- `FAILED` sim older than 2h is cancelled
- Custom threshold is respected

Registered in `api/package.json` `test:unit` script after `validation.test.ts`.

### 4. Wire the test into package.json

Append `tsx lib/stale-sweeper.test.ts` to the existing `test:unit` chain.

### 5. Operational documentation: `docs/STALE_SWEEPER.md`

A one-page ops doc covering:
- What the sweeper does and why
- How to set up the Cloud Scheduler job (gcloud command, including the `X-Worker-Secret` header from Secret Manager)
- How to invoke it manually for ad-hoc recovery (`curl -X POST -H "X-Worker-Secret: ..."`)
- How to interpret the `SweepResult` JSON response
- The two tunable env vars (`SIM_HARD_CANCEL_THRESHOLD_MS`, `QUEUED_JOB_HARD_FAIL_THRESHOLD_MS`)

The Cloud Scheduler setup is documented but not automated — the project has no IaC and creating the scheduler job is a one-time action. Setup command (for the doc):

```bash
SECRET=$(gcloud secrets versions access latest --secret=worker-secret --project=magic-bracket-simulator)
gcloud scheduler jobs create http stale-sweeper \
  --project=magic-bracket-simulator \
  --location=us-central1 \
  --schedule="*/15 * * * *" \
  --uri="https://api--magic-bracket-simulator.us-central1.hosted.app/api/admin/sweep-stale-jobs" \
  --http-method=POST \
  --headers="X-Worker-Secret=$SECRET" \
  --description="Eventually recovers stuck jobs by re-running recoverStaleJob and hard-cancelling sims older than 2h"
```

## Failure Handling

- **Sweeper endpoint errors on one job:** Logged to Sentry, collected in `SweepResult.errors`, sweep continues to next job.
- **Sweeper endpoint errors globally:** Returns HTTP 500 to Cloud Scheduler. Scheduler's default retry policy will retry, and the next scheduled invocation (15 min later) will try again regardless.
- **Scheduler stops firing:** Visible in Cloud Scheduler UI. User can check manually by running the curl command in the ops doc. Not self-healing — a dead scheduler is rare enough that the manual check suffices.
- **Race: worker completes sim at the exact moment sweeper cancels it:** The `conditionalUpdateSimulationStatus` transaction rejects the cancel if the sim already moved to `COMPLETED`. Worker write wins; sweeper observation is discarded. No corruption.
- **Sweeper runs while a job is legitimately still processing sims within 2h:** `now - baseline < 2h`, `shouldHardCancelSim` returns false, no sims cancelled. Existing `recoverStaleJob` still runs and does its normal republish-on-5-min-PENDING pass. No harmful side effects.
- **Cloud Scheduler leaks the `X-Worker-Secret` via GCP logs:** Accepted risk. The scheduler job is visible only to project viewers, matching the trust boundary of the existing worker secret deployment.

## Testing Strategy

1. **Unit tests** — pure predicate in `stale-sweeper.test.ts` (see §3).
2. **Type check** — `npm run lint --prefix api` must pass.
3. **Local manual smoke** — run `npm run dev --prefix api`, POST to `/api/admin/sweep-stale-jobs`, verify it returns `{ scanned: 0, ... }` on an empty local DB.
4. **Production smoke** — after deploy, run the curl command from the ops doc once, verify the response JSON, and confirm the Cloud Scheduler job is visible in the GCP console.

## Out of Scope (explicitly deferred)

- Worker synchronous-pull rewrite (would eliminate Pub/Sub starvation at the source).
- Graceful worker shutdown that marks in-flight sims as FAILED before exit.
- Job-level progress telemetry / alerting dashboards.
- Configurable per-job hard-cap (using the global env var for everyone is fine).
