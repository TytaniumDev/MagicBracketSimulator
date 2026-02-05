# Frontend-triggered worker visibility (report-in + stable IDs)

## Summary

Adds a way to see which simulation workers are available and subscribed to Pub/Sub from the frontend. Instead of periodic heartbeats (which would drive Firestore writes and exceed free tier with many workers), this uses **frontend-triggered, one-time status**: when the user clicks "Refresh" in the "Simulation Workers" section, the backend publishes one message to a `worker-report-in` topic; every running worker receives it and sends a **single** heartbeat. The list shown is "workers that responded to this request." Worker IDs are stable across restarts (stored in a file or `WORKER_ID` env).

---

## Changes

### Orchestrator

- **Worker storage (SQLite + Firestore)**
  - `lib/db.ts`: New tables `workers` (worker_id, hostname, subscription, refresh_id) and `worker_refresh` (current refresh round).
  - `lib/worker-store.ts`: SQLite worker store — `setCurrentRefreshId`, `getCurrentRefreshId`, `upsertWorker`, `listWorkers` (filter by current refreshId).
  - `lib/firestore-worker-store.ts`: Firestore worker store — collection `workers`, doc `meta/worker-refresh` for current refreshId; same API.
  - `lib/worker-store-factory.ts`: Picks SQLite vs Firestore using `GOOGLE_CLOUD_PROJECT` (same pattern as job-store-factory).

- **Pub/Sub**
  - `lib/pubsub.ts`: New topic `worker-report-in` (env `PUBSUB_WORKER_REPORT_IN_TOPIC`), `publishWorkerReportIn(refreshId)`.

- **API routes**
  - `POST /api/workers/request-report-in`: Firebase auth. Generates `refreshId`, sets it as current in store, publishes `{ refreshId }` to `worker-report-in`, returns `{ refreshId }`.
  - `POST /api/workers/heartbeat`: Requires `X-Worker-Secret`. Body: `workerId`, `refreshId`, optional `hostname`, `subscription`. Upserts worker with that refreshId. Returns 204.
  - `GET /api/workers`: Firebase auth. Returns `{ workers, refreshId }` — only workers where `refreshId === currentRefreshId`.

### Local worker

- **Stable worker ID**
  - `src/worker.ts`: `getOrCreateWorkerId(jobsDir)` — (1) `WORKER_ID` env, (2) read from `./worker-id` (next to jobs dir), (3) generate UUID and write to file. Ensures same ID across restarts and container restarts when the file is on a persistent volume.

- **Report-in subscription**
  - Subscribes to two Pub/Sub subscriptions: existing `job-created-worker` (jobs) and new `worker-report-in-worker` (env `PUBSUB_WORKER_REPORT_IN_SUBSCRIPTION`).
  - On report-in message: parses `refreshId`, POSTs `/api/workers/heartbeat` with `workerId`, `hostname`, `subscription`, `refreshId`, then acks. No periodic heartbeat timer.
  - Shutdown handler closes both subscriptions.

### Frontend

- **Simulation Workers section** (`pages/Home.tsx`)
  - New section below "Past Runs" with a "Refresh" button.
  - On click: `POST /api/workers/request-report-in`, wait 2.5s, then `GET /api/workers`; display list of workers (truncated id, hostname, subscription, "Responded to last check").
  - Handles loading state, error, and empty state ("No workers responded. Make sure workers are running and subscribed to the report-in topic.").

### Config and docs

- **`.gitignore`**: Added `local-worker/worker-id` so the persisted worker ID file is not committed.
- **`local-worker/README.md`**: Documented worker ID (file + `WORKER_ID` override) and report-in (`PUBSUB_WORKER_REPORT_IN_SUBSCRIPTION`); noted that GCP topic `worker-report-in` and subscription `worker-report-in-worker` must be created and workers granted subscribe permission.
- **`scripts/populate-worker-secret.js`**: Added `PUBSUB_WORKER_REPORT_IN_SUBSCRIPTION` (default `worker-report-in-worker`) to the secret config so it can be stored in Secret Manager.

---

## GCP setup (for worker visibility in production)

Create the report-in topic and subscription and grant workers access:

```bash
gcloud pubsub topics create worker-report-in --project=magic-bracket-simulator
gcloud pubsub subscriptions create worker-report-in-worker --topic=worker-report-in --project=magic-bracket-simulator
```

Ensure the workers’ identity (e.g. service account) has `roles/pubsub.subscriber` on the subscription (or on the project).

---

## Design notes

- **Firestore cost**: Writes occur only when the user clicks Refresh and workers respond (e.g. 10 refreshes/day × 5 workers = 50 writes/day — well within 20K/day free tier).
- **Stable IDs**: Persisted file (and optional `WORKER_ID` env) ensures the same machine/container shows up with the same ID across restarts.
- **No periodic heartbeat**: Avoids ~2,880 writes/worker/day that would quickly exceed Firestore free tier with multiple workers.
