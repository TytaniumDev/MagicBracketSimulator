# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

Magic Bracket Simulator: a tool for evaluating Magic: The Gathering Commander deck performance through automated Forge simulations, tracking win rates and game statistics.

## Build & Dev Commands

```bash
# Install all subproject dependencies (root, api, frontend, worker)
npm run install:all

# Start locally (api:3000, frontend:5173)
npm run dev

# Run in LOCAL mode (restores HOSTED/GCP mode on exit)
npm run dev:local

# Or toggle manually
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

**Desktop worker** (Flutter, `worker_flutter/`):
```bash
cd worker_flutter && flutter pub get
flutter run -d macos                   # or: -d windows
flutter analyze --no-fatal-infos
flutter test
```

### CI

CI runs on PRs to `main`. `.github/workflows/ci.yml` runs `scripts/lint.sh` (frontend + api lint), `scripts/build.sh` (frontend and api builds), `scripts/test.sh` (frontend vitest, api `test:unit` + `test:ingestion`) and the release-script tests. `worker-flutter-ci.yml` runs `flutter analyze` and `flutter test`. After merge, `deploy.yml` deploys the frontend to Firebase Hosting plus Firestore and Realtime Database rules, App Hosting rolls out the API, and `release-worker.yml` publishes a desktop worker build when the merge changed `worker_flutter/` app code or assets (not its tests or docs), the Forge manifest, or the release pipeline. `forge-update.yml` runs nightly and opens an auto-merging PR that bumps `worker_flutter/forge-manifest.json` when Forge has a new release; that merge cuts a worker release, and desktop workers install the new Forge when they restart into it.

## Architecture

`docs/ARCHITECTURE.md` is the system map (diagram, where data lives, a job end to end, delivery). `DATA_FLOW.md` has the step-by-step detail.

### Two Deployment Modes

Mode is auto-detected by `GOOGLE_CLOUD_PROJECT` env var:
- **LOCAL mode** (unset): SQLite (`api/data/jobs.db`), local filesystem, no Firebase auth
- **GCP mode** (set): Firestore, Realtime Database (worker presence), Cloud Storage, Firebase Auth

Both modes share one work queue: desktop workers poll `GET /api/jobs/claim-sim`. There is no Pub/Sub. Local mode has no worker presence, so it never shows workers online.

### Service Boundaries

- **frontend/** — Vite + React + Tailwind v4 + Firebase Auth (Google sign-in), on Firebase Hosting. Writes go through the API over HTTP; live job, sim and pod-run state is read straight from Firestore (`onSnapshot`) and worker status from Realtime Database. Config in `frontend/public/config.json` (committed, not secret).
- **api/** — Next.js 15 app on Firebase App Hosting (one 1 GiB instance, so never hold more than one job's raw logs in memory). API routes under `app/api/`. Handles deck ingestion, job lifecycle, sim claiming and leases, log storage, aggregation, ratings, card stats, pod runs and access control. It is the only writer to Firestore and GCS. Uses factory pattern (`*-store-factory.ts`) to swap SQLite/Firestore backends.
- **worker_flutter/** — Desktop worker for macOS and Windows, and the only worker. Cloud mode claims sims through the API (claim, lease, report, log upload), authenticated with the signed-in user's Firebase ID token; offline mode runs bundled precons locally (drift SQLite). It runs Forge as a local Java process and installs Forge from `worker_flutter/forge-manifest.json`, fetched from `main` at launch. Released through GitHub Releases + `appcast.xml` (Sparkle / WinSparkle). Aggregation happens in the API, not here.
- **shared/types/** — Types shared by api and frontend: jobs and seats, simulations, pod runs, worker presence, the job state machine.

### Key Patterns

- **Factory pattern for storage**: `api/lib/*-factory.ts` files return SQLite or Firestore implementations based on mode. The API routes use these factories, never import concrete stores directly.
- **Desktop worker loop**: `WorkerEngine` (`worker_flutter/lib/worker/worker_engine.dart`) claims sims up to the user's capacity setting, runs each with `SimRunner`, keeps its lease with `SimLeaseKeeper`, then uploads the log with `LogUploader` and reports the result through `SimApi`. When a claim finds no work it asks `CoverageRequester` for an auto-coverage job (throttled to one empty ask per 5 minutes).
- **Per-simulation tracking**: Individual simulation states (PENDING/RUNNING/COMPLETED/FAILED/CANCELLED) tracked via the `jobs/{id}/simulations` subcollection or SQLite table, streamed to frontend via Firestore `onSnapshot` (GCP) or TanStack Query polling (local).
- **Seats**: a job is one 4-deck pod. `jobs.seats` is `[{deckId, name, link, colorIdentity}]` and `results` is `{gamesPlayed, seats: [{wins, avgWinTurn}]}` in seat order (`shared/types/job.ts`, `api/lib/job-seats.ts`, `api/lib/job-results.ts`). Forge winner names are mapped to seats only at aggregation; workers receive decks as `[{name, dck}]` from the worker view of `GET /api/jobs/:id`.
- **Storage split**: Firestore holds live state and precomputed answers (jobs, sims, pod runs with their `standings`, decks, `decks/{id}/stats/rating` and `decks/{id}/stats/cards`). GCS holds per-game facts under `jobs/{jobId}/`: raw logs per sim (kept forever) plus `condensed.json` and `structured.json`, all gzipped. Clients only read Firestore, and only approved users (`firestore.rules` checks `users/{uid}.status == 'allowed'`); every write goes through the API. Every Firestore time is a `Timestamp`; the API returns ISO strings.
- **No migration code**: prod data was reset on 2026-10-29, and schema changes ship without backwards-compat or migration code. The SQLite schema has no migrations: after a schema change, delete `api/data/jobs.db`.
- **Access control**: users sign in with Google. The API lets a user in when their `users/{uid}` record has `status: 'allowed'` or their email is in `ADMIN_EMAILS` / `ALLOWED_EMAILS` (`api/lib/allowed-users.ts`, `api/lib/user-store.ts`, `api/lib/auth.ts`). New users request access in the app and an admin approves from the email link; `GET /api/me` gives admins and `ALLOWED_EMAILS` accounts an allowed record so the Firestore rules see them. API routes use `verifyAllowedUser`, including the worker routes (the desktop worker sends its user's ID token); only `/api/me` and `/api/access-requests` take any signed-in user. Internal callers (Cloud Tasks, Cloud Scheduler) send `WORKER_SECRET` as `X-Worker-Secret` (`isInternalRequest` in `api/lib/auth.ts`); the same secret signs access-request approval links.
- **Crash recovery**: each RUNNING sim carries a 3-minute lease that its worker extends about once a minute (`api/lib/sim-lease.ts`); an expired lease makes the sim claimable again. `recoverStaleJob` runs from the per-job Cloud Tasks check (`POST /api/jobs/:id/recover`) and the 15-minute Cloud Scheduler sweep (`POST /api/admin/sweep-stale-jobs`, `api/lib/stale-sweeper.ts`).
- **Deck resolution**: Supports Moxfield URLs, precon names, and raw deck text. Resolution happens in `api/lib/moxfield-service.ts`; a job's deck ids become its `seats` in `api/lib/job-seats.ts`. The daily Archidekt precon sync (`api/lib/archidekt-sync.ts`) loads every precon from the Archidekt_Precons account, including new ones as they appear; admins hide unwanted decks on the Decks page. Card names reach Forge as front faces only (`api/lib/forge-card-name.ts`): Forge drops "Front // Back" names for every layout except split cards.
- **Worker presence**: online workers live in Realtime Database at `presence/{workerId}` (`shared/types/worker-presence.ts`, rules in `database.rules.json`). The desktop worker writes its own entry with an onDisconnect delete; the API and frontend only read presence. Crash recovery uses sim leases (`api/lib/sim-lease.ts`), not presence. Cancellation reaches a worker through its lease extension answer.

### Data Flow Documentation

`DATA_FLOW.md` is the source of truth for the end-to-end data flow from simulation completion through worker reporting, API aggregation, and frontend consumption.

**When modifying any of these areas, you MUST:**
1. Read DATA_FLOW.md first to understand the current flow
2. Update DATA_FLOW.md if your changes alter the data flow (new fields, changed endpoints, modified aggregation logic, etc.)
3. Ensure test coverage exists for the part of the flow you changed — see the test files listed in DATA_FLOW.md

Areas covered: worker result reporting, API status updates, log upload/storage, aggregation pipeline (condense + structure), Firestore onSnapshot streaming, frontend log retrieval, race condition guards.

### Frontend Structure

- `src/App.tsx` — Router setup (react-router-dom v7)
- `src/index.css` — Design tokens (Tailwind v4 `@theme`): `canvas`, `surface`, `surface-raised`, `line`, `fg`, `fg-muted`, `accent`, `mana-*`. Use these in new and touched UI instead of raw palette colors
- `src/components/ui/` — Small shared primitives (`ColorBar`, `IconButton`, `Popover`, `MarqueeText`, icons)
- `src/components/DeckGrid.tsx` — Decks in sections: `DeckCard` (full commander card, hover to enlarge) on wide screens, `DeckRow` on phones; commander images and set codes come from Scryfall in the browser. Each tile's target selects the deck or links to a page (`DeckTileTarget` in `utils/deck-tile.ts`). `DeckPicker.tsx` wraps it for selection on New Simulation; the Decks page uses it with links
- `src/pages/Browse.tsx` — Home page (`/`): recent jobs and pod runs
- `src/pages/Home.tsx` — Submit page (`/submit`): Add deck popover, sticky `PodSlots` + `RunControl` (games per pod behind the gear), sort menu (`utils/deck-order.ts`) and the deck picker
- `src/components/WorkerStatusPill.tsx` — Workers online, in the app bar on every page
- `src/pages/JobStatus.tsx` — Job progress and results (`/jobs/:id`)
- `src/pages/PodRun.tsx` — Pod runs (`/pods`, `/pods/:id`): standings across a run's pods
- `src/pages/Leaderboard.tsx` — Deck ratings (`/leaderboard`)
- `src/pages/WorkerSetup.tsx` — Desktop worker downloads (`/worker-setup`)
- `src/pages/DeckPage.tsx` — Deck page (`/decks/:id`): results plus a compact decklist with Scryfall hover previews
- `src/pages/Decks.tsx` — Decks page (`/decks`): every deck as a commander card grouped by set, linking to its deck page; excluded decks are faded and admins toggle them. Shares `AddDeckButton` with New Simulation
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
- `PATCH /api/jobs/:id/simulations/:simId` — Update simulation status (worker)
- `POST /api/jobs/:id/logs/simulation` — Upload one sim's raw log (worker); `GET .../logs/raw|condensed|structured` read them
- `POST /api/jobs/:id/cancel`, `POST /api/jobs/:id/recover` — Cancel a job; Cloud Tasks recovery check
- `GET /api/workers` — Online workers and queue depth
- `POST /api/coverage/next-job` — An idle worker asks for the next auto-coverage job
- `GET /api/me`, `POST /api/access-requests`, `GET /api/access-requests/approve` — Current user's access, request access, admin approval link
- `POST /api/admin/sweep-stale-jobs` — Stale sweeper (Cloud Scheduler); other `admin/` routes backfill ratings and card stats
- `GET /api/leaderboard` — Deck ratings
- `GET/POST /api/pod-runs`, `GET /api/pod-runs/:id` — Saved pod runs (one job per 4-deck pod); `?jobId=` finds the run a job belongs to
- `GET /api/decks` — Every deck plus `excludedDeckIds` (decks hidden from the picker and auto-coverage)
- `GET /api/decks/:id` — Deck page data: metadata, parsed decklist, results
- `PATCH /api/decks` — Exclude decks from selection or include them again in one write (admin, `{ deckIds, excluded }`); the Decks page updates optimistically
- `GET /api/decks/:id/card-impact` — Per-card impact scores (most game-swinging cards), from counters built at aggregation
- Deck and precon CRUD endpoints

## Environment & Secrets

- `.env` files are gitignored; see `docs/MODE_SETUP.md` for required variables per mode
- `frontend/.env` needs Firebase config vars (see `frontend/.env.example`)
- `api/.env` needs for GCP mode: `GOOGLE_CLOUD_PROJECT`, `GCS_BUCKET`, `WORKER_SECRET`
- `deploy.yml` authenticates to GCP with workload identity (`GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SERVICE_ACCOUNT`), loaded from Doppler
- Doppler is the source of truth for secrets. The **Sync API Secrets** workflow (`gh workflow run sync-api-secrets.yml`) copies every secret referenced in `api/apphosting.yaml` from Doppler into GCP Secret Manager (see `docs/SECRETS_SETUP.md`)

### Sentry

Error tracking via `@sentry/nextjs` in `api/`. Graceful no-op when `SENTRY_DSN` is unset.

- **Runtime DSN**: `SENTRY_DSN` — set in `api/apphosting.yaml` via GCP Secret Manager (`sentry-dsn`)
- **API auth token** (for managing alerts, releases, source maps): stored in GCP Secret Manager as `sentry-auth-token`. Retrieve with:
  ```bash
  gcloud secrets versions access latest --secret=sentry-auth-token
  ```
  Also available in `api/.env` as `SENTRY_AUTH_TOKEN` for local use.
- **Sentry org/projects**: `tytaniumdev` / `magic-bracket-api`, `magic-bracket-worker` (desktop worker) and `magic-bracket-frontend` (DSN in `frontend/public/config.json`)
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
