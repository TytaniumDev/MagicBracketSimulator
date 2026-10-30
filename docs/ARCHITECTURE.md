# Magic Bracket Simulator — Architecture Overview
Last Updated: 2026-10-30

How the pieces fit together today. `DATA_FLOW.md` (repo root) is the
detailed, step-by-step source of truth for dispatch, reporting and
aggregation; this page is the map.

---

## The pieces

```mermaid
flowchart TB
    User((User)) --> Frontend

    subgraph firebase [Firebase / GCP project magic-bracket-simulator]
        Frontend[Firebase Hosting<br/>React SPA]
        API[App Hosting<br/>Next.js API]
        Firestore[(Firestore<br/>live state + precomputed stats)]
        RTDB[(Realtime Database<br/>worker presence)]
        GCS[(Cloud Storage<br/>gzipped logs + derived JSON)]
        Tasks[Cloud Tasks<br/>per-job recovery]
        Scheduler[Cloud Scheduler<br/>stale sweeper, 15 min]
        Auth[Firebase Auth<br/>Google sign-in]
    end

    subgraph desktop [Desktop worker: worker_flutter]
        Flutter[Flutter app<br/>macOS / Windows]
        Java[Forge via local Java]
        Flutter --> Java
    end

    Frontend -->|REST + ID token| API
    Frontend -.->|onSnapshot reads| Firestore
    Frontend -.->|presence reads| RTDB
    API --> Firestore
    API --> GCS
    API -.->|presence reads| RTDB
    Tasks --> API
    Scheduler --> API

    Flutter -->|claim / lease / PATCH / logs<br/>user ID token| API
    Flutter -.->|own presence entry| RTDB
```

| Piece | Where it runs | What it does |
|-------|---------------|--------------|
| **Frontend** (`frontend/`) | Firebase Hosting | Vite + React + Tailwind v4. Writes go through the API; live job, sim and pod-run state comes straight from Firestore `onSnapshot`, worker status from Realtime Database. |
| **API** (`api/`) | Firebase App Hosting (Cloud Run underneath), 1 instance, 1 GiB | Next.js 15 route handlers. Deck ingestion, job lifecycle, sim claiming and leases, log storage, aggregation, ratings, card stats, pod runs, access control. The only writer to Firestore and GCS. |
| **Desktop worker** (`worker_flutter/`) | User machines (macOS, Windows) | The only worker. Cloud mode claims sims from the shared queue through the API with the signed-in user's token; offline mode runs bundled precons locally (drift SQLite). Ships through GitHub Releases + `appcast.xml` (Sparkle / WinSparkle) and installs Forge from `worker_flutter/forge-manifest.json`. |
| **Shared types** (`shared/types/`) | Imported by api and frontend | Job, seat, simulation, pod-run, worker-presence and state-machine types. |

---

## Where data lives

**Firestore** holds live state and precomputed answers. Clients only read,
and only approved users (their `users/{uid}` record is `allowed`); every
write goes through the API with the Admin SDK (`firestore.rules`).

| Path | Contents |
|------|----------|
| `jobs/{jobId}` | One 4-deck pod: `seats` `[{deckId, name, link, colorIdentity}]`, status, sim counters, `results` `{gamesPlayed, seats: [{wins, avgWinTurn}]}` in seat order, `podRunId` |
| `jobs/{jobId}/simulations/{simId}` | One sim: state (PENDING / RUNNING / COMPLETED / FAILED / CANCELLED), `workerId`, `leaseExpiresAt`, winners |
| `podRuns/{runId}` | A saved run of several pods with its own `standings` |
| `decks/{deckId}` | Deck metadata and `.dck` content (precons and imports); `excluded: true` hides it from the picker and auto-coverage. A changed list is a new deck; there are no versions. |
| `decks/{deckId}/stats/rating`, `.../stats/cards` | TrueSkill and win counters, and per-card impact counters, built at aggregation |
| `users/{uid}` | Access record, `status: requested \| allowed`. Not readable by clients. |
| `config/coverage`, `idempotencyKeys/*` | Auto-coverage settings, job-creation idempotency |

Every time field in Firestore is a `Timestamp`; the API converts them to ISO
strings at the edge.

**Realtime Database** holds `presence/{workerId}`: an entry per online
desktop worker (`shared/types/worker-presence.ts`, rules in
`database.rules.json`). Each worker writes its own entry about once a minute
with an onDisconnect delete; the API and frontend only read them.

**Cloud Storage** (`magic-bracket-simulator-artifacts`) holds per-game
facts under `jobs/{jobId}/`: raw logs per sim (`raw/game_NNN.txt`, kept
forever) plus `condensed.json` and `structured.json`, all stored gzipped.

**Local mode** swaps these for SQLite (`api/data/jobs.db`) and the
filesystem (`logs-data/`, saved decks in `data/decks/`). The SQLite schema
has no migrations: after a schema change, delete `jobs.db`. Local mode has no
worker presence, so it never lists workers as online.

---

## A job, end to end

1. **Create.** The frontend posts 4 deck ids to `POST /api/jobs` (or the
   coverage service picks a pod). The API writes the job with its `seats`,
   creates one PENDING sim doc per container, and schedules a Cloud Tasks
   recovery check.
2. **Claim.** Desktop workers poll `GET /api/jobs/claim-sim?lease=1`. The API
   claims the oldest claimable sim in a transaction, promotes the job from
   QUEUED to RUNNING on its first claim, and returns the sim. The worker
   fetches decklists with `GET /api/jobs/:id?view=worker`, which reads
   each seat's `.dck` by deck id.
3. **Run and hold the lease.** The worker runs Forge and extends the sim's
   3-minute lease about once a minute. The answer can tell it the job was
   cancelled or that another worker took the sim over.
4. **Report.** The worker uploads the raw log
   (`POST /api/jobs/:id/logs/simulation`) and then reports the result
   (`PATCH /api/jobs/:id/simulations/:simId`). An atomic counter on the job
   detects the last sim.
5. **Aggregate** (API, `aggregateJobResults`). Reads the raw logs, condenses
   and structures every game, writes `condensed.json` and
   `structured.json`, maps Forge winner names to seats, and sets the job
   COMPLETED with per-seat results. Then, fire-and-forget and idempotent per
   job: deck ratings, card stats, and the pod run's standings.
6. **Watch.** The frontend listens to the job and its sims in Firestore, so
   progress and results appear without polling (local mode polls the REST
   API instead).

**Crash recovery** uses the sim leases, not worker presence: a sim whose
lease has expired is claimable again. `recoverStaleJob` runs from the
per-job Cloud Tasks check and from the 15-minute stale sweeper
(`POST /api/admin/sweep-stale-jobs`), which also fails jobs stuck in the
queue and finishes jobs whose sims are all terminal.

---

## Access and auth

- Users sign in with Google (Firebase Auth). The API accepts a user when
  their `users/{uid}` record is `allowed` or their email is in
  `ADMIN_EMAILS` / `ALLOWED_EMAILS` (`api/lib/allowed-users.ts`,
  `api/lib/auth.ts`). New users request access in the app; an admin
  approves from the email link (`/api/access-requests/approve`).
  `GET /api/me` gives admins and `ALLOWED_EMAILS` accounts an allowed
  record, since the Firestore rules only see that doc. Signed out, or
  before approval, nothing is readable.
- The desktop worker signs in as its owner and sends that user's ID token,
  so the worker routes use the same `verifyAllowedUser` check as every
  other route.
- Internal callers (Cloud Tasks recovery checks, the Cloud Scheduler sweep
  and precon sync) send the shared `WORKER_SECRET` as `X-Worker-Secret`
  (`isInternalRequest` in `api/lib/auth.ts`). The same secret signs
  access-request approval links.
- Local mode has no auth.

---

## Delivery

| Workflow | What it ships |
|----------|---------------|
| `ci.yml` | PR checks: lint, build, test (frontend, api), release-script tests |
| `worker-flutter-ci.yml` | `flutter analyze` + `flutter test` for the desktop worker |
| `deploy.yml` | On merge: frontend to Firebase Hosting, Firestore rules + indexes, Realtime Database rules |
| App Hosting | Builds and rolls out the API from `main`; `rollout-safety-net.yml` forces a rollout if one doesn't appear |
| `release-worker.yml` | Desktop worker builds, GitHub Release, `appcast.xml` |
| `forge-update.yml` | Nightly: bumps `worker_flutter/forge-manifest.json` to the latest Forge release in an auto-merging PR; desktop workers install it on their next launch |
| `sync-api-secrets.yml` | Copies the API's secrets from Doppler (source of truth) into GCP Secret Manager |

Errors go to Sentry (org `tytaniumdev`): projects `magic-bracket-api`,
`magic-bracket-worker` and `magic-bracket-frontend`.

---

## Key code references

| Concept | Location |
|---------|----------|
| Storage factories (SQLite vs Firestore) | `api/lib/*-store-factory.ts` |
| Sim claiming and leases | `api/app/api/jobs/claim-sim/`, `api/lib/sim-lease.ts` |
| Seats and per-seat results | `api/lib/job-seats.ts`, `api/lib/job-results.ts`, `shared/types/job.ts` |
| Aggregation | `api/lib/job-store-factory.ts` (`aggregateJobResults`), `api/lib/log-store.ts`, `api/lib/condenser/` |
| Ratings, card stats, pod standings | `api/lib/trueskill-service.ts`, `api/lib/card-impact/`, `api/lib/pod-run-standings.ts` |
| Recovery | `api/lib/stale-sweeper.ts`, `api/lib/cloud-tasks.ts`, `api/app/api/jobs/[id]/recover/` |
| Worker presence | `api/lib/worker-presence-store.ts`, `frontend/src/hooks/useWorkerStatus.ts`, `worker_flutter/lib/worker/worker_presence.dart` |
| Desktop worker loop | `worker_flutter/lib/worker/worker_engine.dart`, `sim_api.dart`, `sim_lease_keeper.dart`, `log_uploader.dart` |
| Live job view | `frontend/src/hooks/useJobStream.ts`, `frontend/src/components/SimulationGrid.tsx` |
| Forge install and runs | `worker_flutter/forge-manifest.json`, `worker_flutter/lib/installer/`, `worker_flutter/lib/worker/sim_runner.dart` |
