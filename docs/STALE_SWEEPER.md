# Stale Job Sweeper

A scheduled safety net that guarantees every active Magic Bracket Simulator
job eventually reaches a terminal state (`COMPLETED`, `FAILED`, or
`CANCELLED`) without manual intervention.

## What it does

Every 15 minutes, Cloud Scheduler hits `POST /api/admin/sweep-stale-jobs`.
For each `QUEUED` or `RUNNING` job, the endpoint:

1. **Hard-fails** any job that has sat `QUEUED` for more than 2 hours
   (`QUEUED_JOB_HARD_FAIL_THRESHOLD_MS`, default `7200000`).
2. **Hard-cancels** any simulation on a `RUNNING` job whose age — measured
   from `job.startedAt`, falling back to `job.createdAt` — exceeds 2 hours
   (`SIM_HARD_CANCEL_THRESHOLD_MS`, default `7200000`). Cancellation uses
   conditional writes so a worker completing a sim at the last millisecond
   always wins the race.
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
24/25 sims for ~12 hours because of a worker restart plus Pub/Sub
starvation.
