# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

Magic Bracket Simulator: a tool for evaluating Magic: The Gathering Commander deck performance through automated Forge simulations, tracking win rates and game statistics.

## Build & Dev Commands

```bash
# Install all subproject dependencies (root, api, frontend, worker)
npm run install:all

# Start locally (api:3000, frontend:5173; run worker separately via Docker)
npm run dev

# Run in LOCAL mode (auto-restores GCP worker on exit)
npm run dev:local

# Or toggle manually (also cycles the worker Docker container)
npm run mode:local    # switch to LOCAL mode
npm run mode:hosted   # switch back to HOSTED/GCP mode
```

### Per-service commands

**Frontend** (Vite + React, `frontend/`):
```bash
npm run dev --prefix frontend          # dev server on :5173
npm run build --prefix frontend        # tsc -b && vite build
npm run lint --prefix frontend         # eslint, zero warnings allowed
```

**API** (Next.js, `api/`):
```bash
npm run dev --prefix api               # next dev on :3000
npm run build --prefix api             # next build
npm run lint --prefix api              # tsc --noEmit + eslint, zero warnings allowed
```

**API tests** (all use `tsx` directly, no test framework):
```bash
npm run test:unit --prefix api         # every unit + contract test (list in api/package.json)
npm run test:integration --prefix api  # integration.test.ts
npm run test:ingestion --prefix api    # ingestion.test.ts
```

**Worker** (Docker, `worker/`):
```bash
npm run build --prefix worker          # tsc
npm run test:unit --prefix worker      # override, condenser, sim-lease tests

# GCP mode (HTTP polling via claim-sim)
docker compose -f worker/docker-compose.yml up --build

# Local mode (polls api on localhost:3000)
docker compose -f worker/docker-compose.yml -f worker/docker-compose.local.yml up --build
```

**Simulation image** (Docker, `simulation/`):
```bash
# Build simulation image (context must be repo root)
docker build -f simulation/Dockerfile -t magic-bracket-simulation .
```

**Desktop worker** (Flutter, `worker_flutter/`):
```bash
cd worker_flutter && flutter pub get
flutter run -d macos                   # or: -d windows
flutter analyze --no-fatal-infos
flutter test
```

### CI

CI runs on PRs to `main`. `.github/workflows/ci.yml` runs `scripts/lint.sh` (frontend + api lint), `scripts/build.sh` (frontend, api, worker builds), `scripts/test.sh` (frontend vitest, api `test:unit` + `test:ingestion`, worker `test:unit`) and the release-script tests. `worker-flutter-ci.yml` runs `flutter analyze` and `flutter test`. After merge, `deploy.yml` deploys the frontend to Firebase Hosting plus Firestore and Realtime Database rules, App Hosting rolls out the API, `deploy-worker.yml` pushes the worker and simulation images to GHCR, and `release-worker.yml` publishes a desktop worker build.

## Architecture

`docs/ARCHITECTURE.md` is the system map (diagram, where data lives, a job end to end, delivery). `DATA_FLOW.md` has the step-by-step detail.

### Two Deployment Modes

Mode is auto-detected by `GOOGLE_CLOUD_PROJECT` env var:
- **LOCAL mode** (unset): SQLite (`api/data/jobs.db`), local filesystem, no Firebase auth
- **GCP mode** (set): Firestore, Realtime Database (worker presence), Cloud Storage, Firebase Auth

Both modes share one work queue: workers poll `GET /api/jobs/claim-sim`. There is no Pub/Sub.

### Service Boundaries

- **frontend/** — Vite + React + Tailwind v4 + Firebase Auth (Google sign-in), on Firebase Hosting. Writes go through the API over HTTP; live job, sim and pod-run state is read straight from Firestore (`onSnapshot`) and worker status from Realtime Database. Config in `frontend/public/config.json` (committed, not secret).
- **api/** — Next.js 15 app on Firebase App Hosting (one 1 GiB instance, so never hold more than one job's raw logs in memory). API routes under `app/api/`. Handles deck ingestion, job lifecycle, sim claiming and leases, log storage, aggregation, ratings, card stats, pod runs and access control. It is the only writer to Firestore and GCS. Uses factory pattern (`*-store-factory.ts`) to swap SQLite/Firestore backends.
- **worker_flutter/** — Desktop worker for macOS and Windows, and the path going forward. Cloud mode claims sims through the same API endpoints as the Docker worker, authenticated with the signed-in user's Firebase ID token; offline mode runs bundled precons locally (drift SQLite). Released through GitHub Releases + `appcast.xml` (Sparkle / WinSparkle).
- **worker/** — Slim Node.js Docker image (~100MB), still supported. Polls `GET /api/jobs/claim-sim` in both modes, runs one simulation container per sim via the Docker socket, uploads each sim's raw log and reports its status. Aggregation happens in the API, not here. Runs an HTTP server (port 9090) for push-based control: config updates, cancellation, job notification, and drain.
  - **worker/forge-engine/** — Headless Forge simulator assets: `run_sim.sh` entrypoint, precon decks in `precons/`.
- **simulation/** — Standalone Docker image (~750MB, Java 17 + Forge + xvfb). Runs one sim (`GAMES_PER_CONTAINER` games), prints the log, exits. Spawned by the Docker worker via `docker run --rm`.
- **shared/types/** — Types shared by api and frontend: jobs and seats, simulations, pod runs, worker presence, the job state machine.

### Key Patterns

- **Factory pattern for storage**: `api/lib/*-factory.ts` files return SQLite or Firestore implementations based on mode. The API routes use these factories, never import concrete stores directly.
- **Worker + Simulation split**: Two Docker images. The worker (Node.js) orchestrates simulation containers (Java + Forge) with semaphore-bounded concurrency, auto-scaled by CPU/RAM. See `pollForSims`, `processSimulation` and `Semaphore` in `worker/src/worker.ts`, and `runSimulationContainer` and `calculateLocalCapacity` in `worker/src/docker-runner.ts`.
- **Per-simulation tracking**: Individual simulation states (PENDING/RUNNING/COMPLETED/FAILED/CANCELLED) tracked via the `jobs/{id}/simulations` subcollection or SQLite table, streamed to frontend via Firestore `onSnapshot` (GCP) or TanStack Query polling (local).
- **Seats**: a job is one 4-deck pod. `jobs.seats` is `[{deckId, name, link, colorIdentity}]` and `results` is `{gamesPlayed, seats: [{wins, avgWinTurn}]}` in seat order (`shared/types/job.ts`, `api/lib/job-seats.ts`, `api/lib/job-results.ts`). Forge winner names are mapped to seats only at aggregation; workers still receive decks as `[{name, dck}]` from the worker view of `GET /api/jobs/:id`.
- **Storage split**: Firestore holds live state and precomputed answers (jobs, sims, pod runs with their `standings`, decks, `decks/{id}/stats/rating` and `decks/{id}/stats/cards`). GCS holds per-game facts under `jobs/{jobId}/`: raw logs per sim (kept forever) plus `condensed.json` and `structured.json`, all gzipped. Clients only read Firestore, and only approved users (`firestore.rules` checks `users/{uid}.status == 'allowed'`); every write goes through the API. Every Firestore time is a `Timestamp`; the API returns ISO strings.
- **No migration code**: prod data was reset on 2026-10-29, and schema changes ship without backwards-compat or migration code. The SQLite schema has no migrations: after a schema change, delete `api/data/jobs.db`.
- **Access control**: users sign in with Google. The API lets a user in when their `users/{uid}` record has `status: 'allowed'` or their email is in `ADMIN_EMAILS` / `ALLOWED_EMAILS` (`api/lib/allowed-users.ts`, `api/lib/user-store.ts`, `api/lib/auth.ts`). New users request access in the app and an admin approves from the email link; `GET /api/me` gives admins and `ALLOWED_EMAILS` accounts an allowed record so the Firestore rules see them. API read routes use `verifyAllowedUser`; only `/api/me` and `/api/access-requests` take any signed-in user. The Docker worker sends `X-Worker-Secret`; the desktop worker sends the user's ID token (`isWorkerOrAllowlistedUser` in `api/lib/worker-auth.ts`).
- **Crash recovery**: each RUNNING sim carries a 3-minute lease that its worker extends about once a minute (`api/lib/sim-lease.ts`); an expired lease makes the sim claimable again. `recoverStaleJob` runs from the per-job Cloud Tasks check (`POST /api/jobs/:id/recover`) and the 15-minute Cloud Scheduler sweep (`POST /api/admin/sweep-stale-jobs`, `api/lib/stale-sweeper.ts`).
- **Deck resolution**: Supports Moxfield URLs, precon names, and raw deck text. Resolution happens in `api/lib/moxfield-service.ts`; a job's deck ids become its `seats` in `api/lib/job-seats.ts`. The Archidekt precon sync (`api/lib/archidekt-sync.ts`) keeps only precons released since March of the Machine Commander (`PRECON_CUTOFF_DATE`) and deletes older ones. Card names reach Forge as front faces only (`api/lib/forge-card-name.ts`): Forge drops "Front // Back" names for every layout except split cards.
- **Push-based worker communication**: API pushes config overrides, cancellation commands, and job notifications to the worker's HTTP API (`worker/src/worker-api.ts`). Push helper lives in `api/lib/worker-push.ts`. The Docker worker's heartbeat (`POST /api/workers/heartbeat`) writes its presence entry and returns its concurrency override at startup; every claim response also carries the override in `X-Max-Concurrent-Override`.
- **Worker presence**: online workers live in Realtime Database at `presence/{workerId}` (`shared/types/worker-presence.ts`, rules in `database.rules.json`). The Docker worker's heartbeat reaches it through the API; the desktop worker writes it directly with an onDisconnect delete. Firestore `workers/{id}` keeps only durable fields (owner, push URL, concurrency override). Crash recovery uses sim leases (`api/lib/sim-lease.ts`), not presence.

### Data Flow Documentation

`DATA_FLOW.md` is the source of truth for the end-to-end data flow from simulation completion through worker reporting, API aggregation, and frontend consumption.

**When modifying any of these areas, you MUST:**
1. Read DATA_FLOW.md first to understand the current flow
2. Update DATA_FLOW.md if your changes alter the data flow (new fields, changed endpoints, modified aggregation logic, etc.)
3. Ensure test coverage exists for the part of the flow you changed — see the test files listed in DATA_FLOW.md

Areas covered: worker result reporting, API status updates, log upload/storage, aggregation pipeline (condense + structure), Firestore onSnapshot streaming, frontend log retrieval, race condition guards.

### Frontend Structure

- `src/App.tsx` — Router setup (react-router-dom v7)
- `src/pages/Browse.tsx` — Home page (`/`): recent jobs and pod runs
- `src/pages/Home.tsx` — Submit page (`/submit`): deck picker, job and pod run creation
- `src/pages/JobStatus.tsx` — Job progress and results (`/jobs/:id`)
- `src/pages/PodRun.tsx` — Pod runs (`/pods`, `/pods/:id`): standings across a run's pods
- `src/pages/Leaderboard.tsx` — Deck ratings (`/leaderboard`)
- `src/pages/WorkerSetup.tsx` — Worker install and setup (`/worker-setup`)
- `src/pages/DeckPage.tsx` — Deck page (`/decks/:id`): results plus a compact decklist with Scryfall hover previews
- `src/pages/Decks.tsx` — Decks page (`/decks`): every deck in a grid grouped by set; admins exclude decks from selection
- `src/contexts/AuthContext.tsx` — Firebase Auth provider
- `src/hooks/useJobStream.ts` — Live job + sims (Firestore `onSnapshot`, REST polling in local mode)
- `src/hooks/useWorkerStatus.ts` — Online workers from Realtime Database presence
- `src/errorReporting.ts` — Reports handled errors to Sentry
- `src/api.ts` — API client functions
- `src/config.ts` — Runtime config loader (reads `config.json`)

### API Routes

Routes live under `api/app/api/`. Key endpoints:
- `POST /api/jobs` — Create simulation job
- `GET /api/jobs/:id` — Job status and results (`?view=worker` adds each seat's `.dck` for workers)
- `GET /api/jobs/claim-sim` — Claim the next sim (worker; `lease=1`, 204 when there is no work)
- `POST /api/jobs/:id/simulations/:simId/lease` — Extend a sim's lease (worker): `extended`, `cancelled` or `lost`
- `GET /api/jobs/:id/simulations` — Per-simulation statuses
- `POST /api/jobs/:id/simulations` — Initialize simulation tracking
- `PATCH /api/jobs/:id/simulations/:simId` — Update simulation status (worker)
- `POST /api/jobs/:id/logs/simulation` — Upload one sim's raw log (worker); `GET .../logs/raw|condensed|structured` read them
- `POST /api/jobs/:id/cancel`, `POST /api/jobs/:id/recover` — Cancel a job; Cloud Tasks recovery check
- `POST /api/workers/heartbeat`, `GET /api/workers`, `PATCH /api/workers/:id` — Docker worker heartbeat, worker list, concurrency override
- `GET /api/me`, `POST /api/access-requests`, `GET /api/access-requests/approve` — Current user's access, request access, admin approval link
- `POST /api/admin/sweep-stale-jobs` — Stale sweeper (Cloud Scheduler); other `admin/` routes backfill ratings and card stats
- `GET /api/leaderboard` — Deck ratings
- `GET/POST /api/pod-runs`, `GET /api/pod-runs/:id` — Saved pod runs (one job per 4-deck pod); `?jobId=` finds the run a job belongs to
- `GET /api/decks` — Every deck plus `excludedDeckIds` (decks hidden from the picker and auto-coverage)
- `GET /api/decks/:id` — Deck page data: metadata, parsed decklist, results
- `PATCH /api/decks/:id` — Exclude a deck from selection or include it again (admin, `{ excluded }`)
- `GET /api/decks/:id/card-impact` — Per-card impact scores (most game-swinging cards), from counters built at aggregation
- Deck and precon CRUD endpoints

## Environment & Secrets

- `.env` files are gitignored; see `docs/MODE_SETUP.md` for required variables per mode
- `frontend/.env` needs Firebase config vars (see `frontend/.env.example`)
- `api/.env` needs for GCP mode: `GOOGLE_CLOUD_PROJECT`, `GCS_BUCKET`, `WORKER_SECRET`
- Worker env: `WORKER_API_PORT` (default 9090) and `WORKER_API_URL` (externally reachable URL for push-based API control)
- `deploy.yml` authenticates to GCP with workload identity (`GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SERVICE_ACCOUNT`), loaded from Doppler
- Doppler is the source of truth for secrets. The **Sync API Secrets** workflow (`gh workflow run sync-api-secrets.yml`) copies every secret referenced in `api/apphosting.yaml` from Doppler into GCP Secret Manager; the **Provision Worker** workflow does the same for worker config (see `docs/SECRETS_SETUP.md`)

### Sentry

Error tracking via `@sentry/nextjs` in `api/`. Graceful no-op when `SENTRY_DSN` is unset.

- **Runtime DSN**: `SENTRY_DSN` — set in `api/apphosting.yaml` via GCP Secret Manager (`sentry-dsn`)
- **API auth token** (for managing alerts, releases, source maps): stored in GCP Secret Manager as `sentry-auth-token`. Retrieve with:
  ```bash
  gcloud secrets versions access latest --secret=sentry-auth-token
  ```
  Also available in `api/.env` as `SENTRY_AUTH_TOKEN` for local use.
- **Sentry org/projects**: `tytaniumdev` / `magic-bracket-api`, `magic-bracket-worker` (workers) and `magic-bracket-frontend` (DSN in `frontend/public/config.json`)
- Never swallow an error silently: every caught error is reported to Sentry
- **Alerts**: 4 alert rules configured with GitHub issue creation (labels: `bug`, `sentry`):
  - Error Spike (catch-all), Aggregation Failures (critical), Rating Stats Failures, Backfill Rating Failures

## Lint & Type Checking

- Frontend uses ESLint 9 flat config with typescript-eslint, react-hooks, and react-refresh plugins. Zero warnings policy (`--max-warnings 0`).
- API lint is `tsc --noEmit` plus ESLint, also with zero warnings allowed.
- The desktop worker must pass `flutter analyze`.
- All of these must pass in CI before merge.

## GitHub Agent Behavior

When Claude is triggered from a GitHub issue and completes implementation work:

1. **Always create a PR** when implementation is done — use `gh pr create` targeting `main`:
   ```bash
   gh pr create --base main --head <branch> \
     --title "<title>" \
     --body "<description>\n\nCloses #<issue-number>\n\nGenerated with [Claude Code](https://claude.ai/code)"
   ```
2. **PR title format**: `feat: <short description>` (or `fix:` / `chore:` as appropriate)
3. **PR body** must include: summary bullets, test plan checklist, `Closes #N`, and the Claude Code attribution
4. Include the PR URL in the final GitHub comment so the user can review it directly
