# Precon Sync

Keeps the Firestore `decks` collection up-to-date with Archidekt's
published precon list.

## What it does

Once a day, Cloud Scheduler hits `POST /api/sync/precons`. The handler
calls `syncPrecons()` from `api/lib/archidekt-sync.ts`, which:

1. Pulls the current precon catalog from Archidekt
2. Diffs it against the Firestore `decks` collection
3. Inserts / updates / deletes precon deck docs as needed

## Why it's a Cloud Scheduler job

Previously this was wired up inside `api/instrumentation.ts` as a
`setTimeout` → `setInterval(24h)` pair. That was the wrong shape for a
scale-to-zero serverless container:

- Ran on every cold start instead of on a real schedule — a container
  churning 4x/day would sync 4x instead of once
- Any in-flight Archidekt fetch could race with regular request
  handling and tie up memory while other routes were trying to run
- Invisible to Cloud Logging — nothing recorded "this ran" or "this
  finished"

A scheduled Cloud Scheduler job fixes all three: one invocation per day
regardless of cold-start churn, isolated request lifecycle, logged end
to end.

## One-time Cloud Scheduler setup

```bash
SECRET=$(gcloud secrets versions access latest \
  --secret=worker-secret \
  --project=magic-bracket-simulator)

gcloud scheduler jobs create http precon-sync \
  --project=magic-bracket-simulator \
  --location=us-central1 \
  --schedule="0 7 * * *" \
  --time-zone="Etc/UTC" \
  --uri="https://api--magic-bracket-simulator.us-central1.hosted.app/api/sync/precons" \
  --http-method=POST \
  --headers="X-Worker-Secret=$SECRET" \
  --description="Daily Archidekt → Firestore precon sync"
```

Runs at 07:00 UTC daily. Cloud Scheduler's free tier covers 3 scheduled
jobs per month — this is job #2 (the other is `stale-sweeper`).

## Manual invocation

```bash
SECRET=$(gcloud secrets versions access latest \
  --secret=worker-secret \
  --project=magic-bracket-simulator)

curl -s -X POST \
  -H "X-Worker-Secret: $SECRET" \
  https://api--magic-bracket-simulator.us-central1.hosted.app/api/sync/precons \
  | jq
```

## Related

- `docs/STALE_SWEEPER.md` — the other Cloud Scheduler job
- `api/lib/archidekt-sync.ts` — the actual sync logic
- `api/app/api/sync/precons/route.ts` — the HTTP endpoint
