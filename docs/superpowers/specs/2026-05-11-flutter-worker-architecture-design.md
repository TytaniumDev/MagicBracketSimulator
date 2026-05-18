# Flutter Desktop Worker Architecture

**Date:** 2026-05-11
**Status:** Design — pending implementation planning

## Goal

Replace the polling-based, Docker-hosted worker with a native desktop application that communicates with the backend in real time, while keeping the existing Docker worker fully operational throughout the transition.

The new worker delivers:

- **Sub-second control plane**: cancel, capacity changes, and job pickup propagate via Firestore listeners (~200ms) instead of 3-second polling.
- **Fast crash recovery**: lease-based detection reclaims sims within ~27s of worker disappearance, versus today's 120s+.
- **Frictionless setup**: a downloadable installer (`.dmg`, `.exe`, `.AppImage`) replaces the `docker compose` + `setup-worker.sh` flow. A user with a spare Mac or PC can host a worker by double-clicking an installer.
- **No new external services**: built entirely on Firestore + Cloud Tasks, both of which the project already uses and which sit comfortably in free tier at hobby scale.

## Non-goals

- **Removing the existing Docker worker.** This work is purely additive. Docker workers stay supported indefinitely; headless servers may continue to prefer them.
- **Replacing `worker-push.ts`, `worker-api.ts`, `/api/jobs/claim-sim`, or related REST endpoints.** They remain in service for the Docker path.
- **Migrating Forge data delivery.** Card data still ships bundled with releases; out-of-band card-set updates are a future enhancement, not part of this work.
- **Mobile companion app.** Flutter supports it, but it is out of scope for this design.

## Problem statement

Today the worker is a Docker container that polls the API every 3 seconds for new sims, heartbeats every 60 seconds, and accepts control commands via best-effort HTTP push to a separate HTTP server it runs internally. Three pain points motivate this work:

1. **Polling feels archaic.** Job pickup, capacity changes, and cancellation all carry up to 3 seconds of avoidable latency.
2. **Crash recovery is slow.** When a worker disappears mid-job (network drop, host sleep, container kill), its RUNNING sims sit unrecoverable for at least 120 seconds — and in practice longer due to the 15-minute stale sweep cadence.
3. **Worker setup has friction.** Running a Docker worker requires installing Docker Desktop, configuring tokens, and running `docker compose` — a meaningful barrier for non-technical users who could otherwise donate compute (laptop, spare desktop).

## High-level architecture

The new worker is a Flutter Desktop application with three layers:

- **UI (Dart widgets)**: a system tray icon plus an on-demand dashboard window showing status, capacity controls, the active sim list, and recent logs. On macOS the dashboard is fully hidden via `LSUIElement` until the tray is clicked. On Windows, the dashboard window starts hidden and is shown on tray click (functionally equivalent).
- **Worker logic (Dart)**: the orchestration code, ported from `worker/src/worker.ts`. Listens to Firestore for work and control commands, spawns Java sim processes, writes a lease heartbeat, and uploads logs to the existing API endpoint.
- **Bundled assets**: a `jlink`-trimmed JRE (~40 MB) and Forge JARs plus card data (~150 MB), packaged as Flutter resources and invoked via `Process.start` from Dart. No Docker dependency.

The frontend and API are largely unchanged. The API's existing cancel endpoint already writes `status: 'CANCELLED'` to Firestore for the frontend's benefit; Flutter workers simply observe those writes via their own listeners. The only new server-side component is a self-rescheduling Cloud Task that performs lease-expiry sweeps every ~12 seconds.

```
┌────────────────────────┐
│  Frontend (unchanged)  │ ── Firestore onSnapshot ───┐
└────────────────────────┘                            │
                                                      ▼
┌────────────────────────┐         ┌──────────────────────────────┐
│  API (slimmed but      │ ──────► │           Firestore           │
│  not reduced)          │         │  jobs / simulations / workers │
└──────┬─────────────────┘         └────────────────▲──────────────┘
       │ POST /logs                                  │
       │ (both worker types)                         │ reads/writes via
       │                                             │ cloud_firestore SDK
       │ HTTP push (Docker only)                     │
       ▼                                             │
┌────────────────┐                ┌──────────────────┴──────────────┐
│ Docker worker  │                │  Flutter Desktop worker (new)   │
│ (unchanged)    │                │  - Tray + lazy dashboard         │
└────────────────┘                │  - Firestore listener loop       │
                                  │  - Bundled JRE + Forge           │
                                  └─────────────────────────────────┘
```

## Coexistence and rollback

Both worker types operate on the same Firestore collections. They differ only in *how* they reach Firestore: the Docker worker through the existing REST endpoints, the Flutter worker directly via the `cloud_firestore` Dart SDK. Both ultimately perform atomic Firestore transactions to claim sims, so race conditions are impossible regardless of mix.

For any user, at any time, switching back to the Docker path is: stop the Flutter app, `docker compose up`. No data migration, no state corruption. The old `worker/` directory remains in the repository untouched.

Future removal of the Docker path is **out of scope** and may never happen — Docker workers are well-suited to headless servers and benefit from the new lease-recovery logic being purely opt-in (it cannot affect them).

## Data model

All schema changes are additive. Docker workers continue to write the existing fields and are never touched by the new sweep.

### `workers/{workerId}` — extended

New optional fields (Flutter workers only):

- `workerType: 'docker' | 'flutter'` — distinguishes types for sweep logic.
- `maxConcurrentOverride: number | null` — replaces the response-header override pattern for Flutter workers.
- `lease.expiresAt: Timestamp` — set to `now + 15s`, refreshed every 5s.
- `lease.activeSimIds: string[]` — the sims currently held by this worker.

### `jobs/{jobId}` and `simulations/{simId}` — unchanged

No schema changes. Flutter workers query and listen to the same fields Docker workers use.

## The four worker behaviors

### 1. Job pickup

Flutter worker listens to `simulations where state == 'PENDING'`. When a sim appears and the worker has local capacity, it runs an atomic Firestore transaction to flip the sim to `RUNNING` with its workerId. On success it spawns the child Java process and adds the simId to its local active set.

Latency: ~200-300ms (listener push + transaction round-trip), down from up to 3000ms.

### 2. Lease heartbeat

Every 5 seconds, the worker writes to its `workers/{id}` doc:

- `lastSeen = now` (for compatibility with existing recovery)
- `lease.expiresAt = now + 15s`
- `lease.activeSimIds = [current active set]`

One write per worker per 5s. At hobby scale this stays comfortably within Firestore's 500K/day free write quota.

### 3. Cancellation reception

When a Flutter worker claims a sim, it opens a per-job `onSnapshot` listener on `jobs/{jobId}` and tracks the listener handle alongside the simId in its local active set. When the job's `status` flips to `CANCELLED`, the listener fires and the worker kills the corresponding Java child process, writes the sim back to Firestore as `CANCELLED` with workerId cleared, and disposes the listener.

This per-job listener pattern (rather than a single collection-wide listener filtered by status) keeps Firestore read cost bounded by the number of jobs the worker is currently running — typically 1-3 — instead of accumulating reads for every historical cancellation.

The API's existing cancel endpoint already writes `status: 'CANCELLED'` to Firestore (the frontend depends on this for live status updates). No new API code is required for the cancel-receive path itself; Flutter workers simply observe the writes the API already makes. The existing HTTP push to Docker workers continues unchanged.

Latency: ~100-300ms versus today's 50ms-best-case / 3s-worst-case.

### 4. Capacity changes

API writes `workers/{id}.maxConcurrentOverride = N`. Flutter workers see it via their existing `workers/{id}` listener and update their local semaphore. Docker workers continue receiving overrides via the existing response-header pattern.

## Crash recovery

A self-rescheduling Cloud Task runs every ~12 seconds. Each invocation:

1. Queries `workers where lease.expiresAt < now`. This automatically excludes Docker workers because they lack the `lease` field.
2. For each expired worker, reads `lease.activeSimIds` and runs a transaction per simId: if the sim is still RUNNING and still owned by that workerId, flip to PENDING, clear workerId, increment retryCount.
3. Updates the expired worker doc to `status = 'crashed'` and clears the lease.
4. Reschedules itself for +12s.

Worst-case detection time: 15s (lease) + 12s (sweep cadence) = **27 seconds** from worker disappearance to sims being available for re-claim.

Coexistence safety properties:

- The query filter on `lease.expiresAt` ensures Docker workers are never touched.
- The transaction's `workerId == thisWorker` guard prevents double-revert if sweeps overlap.
- Existing 120s `lastSeen` recovery and 15-minute hard sweep remain as catch-alls.

## Log upload

Flutter workers upload sim logs to the existing `POST /api/jobs/:id/logs/simulation` endpoint, identical to Docker workers. Direct Cloud Storage upload via `firebase_storage` is technically possible but adds permissions complexity and provides no user-visible benefit at this scale.

## Aggregation

No changes. The existing `completedSimCount` atomic counter on `jobs/{id}` continues to drive auto-aggregation. Flutter workers increment it the same way Docker workers do.

## User experience changes

- **Installation**: download an installer for the user's OS, run it. No Docker, no terminal, no tokens to paste.
- **First launch**: sign in with Google (Firebase Auth via desktop OAuth flow), choose a max concurrency, optionally set "launch at login." Worker registers itself in Firestore.
- **Daily use**: tray icon shows status. Click to open a dashboard window with active sims, recent logs, and capacity slider. Close the window to return to tray-only.
- **Updates**: app auto-updates via Flutter's `auto_updater` package (or a self-rolled Sparkle/MSIX flow). Forge data updates ship inline with app releases initially; out-of-band data updates are a future enhancement.

## Key risks and open questions

1. **Forge cross-platform headless verification.** Forge currently runs in Docker with `xvfb` providing a virtual display. On macOS and Windows, `-Djava.awt.headless=true` should suffice, but this needs a one-day spike to verify: extract Forge JARs from the simulation image, run them directly on a Mac with the headless flag, confirm a sim completes. If Forge requires display access on a code path we hit, that's targeted Java work, not architectural.
2. **Firebase Auth desktop OAuth flow.** Flutter desktop's Google sign-in requires either a custom OAuth client setup or a third-party package (`firebase_auth_oauth`, `googleapis_auth`). Needs validation that the flow is acceptable UX-wise.
3. **`tray_manager` package migration.** The maintainer is moving to a newer `nativeapi-flutter` library. Current version (0.5.2) works fine, but we should track the migration and decide whether to ride along or switch to the alternative `system_tray` package.
4. **Code signing and notarization.** macOS notarization requires an Apple Developer account ($99/year). Windows code signing is optional but improves install UX. Distribution mechanics need a plan but don't affect architecture.
5. **JRE size on the high end.** Trimmed JRE estimate is 40 MB; if jlink-trimming proves harder than expected (some Forge code paths might require modules we'd want to drop), the installer could grow to 80 MB. Still acceptable, just worth knowing.

## Out of scope

- Removing any existing worker code, REST endpoint, or Docker artifact.
- Mobile companion app (Flutter supports it; not in scope here).
- Live log streaming over WebRTC or any direct frontend-to-worker channel.
- Direct Cloud Storage log upload from the Flutter worker.
- A managed real-time bus (Ably, Pusher) — Firestore covers the same need at zero new vendor cost.

## Metrics summary

| Metric | Today (Docker) | With Flutter worker |
|---|---|---|
| Job create → worker pickup | up to 3000ms | ~200-300ms |
| Cancel propagation | 50-3000ms | ~100-300ms |
| Capacity change visibility | next 3000ms poll | ~200ms |
| Worker crash → sim reclaim | ≥120s | ~27s worst case |
| New external services | — | None |
| User setup | Install Docker, run setup script | Double-click installer |
