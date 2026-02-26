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
npm run lint --prefix api              # tsc --noEmit (type-check only)
```

**API tests** (all use `tsx` directly, no test framework):
```bash
npm run test:unit --prefix api         # game-logs.test.ts
npm run test:integration --prefix api  # integration.test.ts
npm run test:ingestion --prefix api    # ingestion.test.ts
```

**Worker** (Docker, `worker/`):
```bash
# GCP mode (Pub/Sub)
docker compose -f worker/docker-compose.yml up --build

# Local mode (polls api on localhost:3000)
docker compose -f worker/docker-compose.yml -f worker/docker-compose.local.yml up --build
```

**Simulation image** (Docker, `simulation/`):
```bash
# Build simulation image (context must be repo root)
docker build -f simulation/Dockerfile -t magic-bracket-simulation .
```

### CI

CI runs on PRs to `main` (.github/workflows/ci.yml): frontend lint+build, api lint+build+test:unit. Deploy workflow deploys frontend to Firebase Hosting after merge.

## Architecture

### Two Deployment Modes

Mode is auto-detected by `GOOGLE_CLOUD_PROJECT` env var:
- **LOCAL mode** (unset): SQLite, local filesystem, polling worker, no Firebase auth
- **GCP mode** (set): Firestore, Cloud Storage, Pub/Sub queue, unified Docker worker

### Service Boundaries

- **frontend/** — Vite + React + Tailwind v4 + Firebase Auth (Google sign-in). Calls the API over HTTP. Config in `frontend/public/config.json` (committed, not secret).
- **api/** — Next.js 15 app: API routes under `app/api/`. Handles deck ingestion (Moxfield URLs, precon names, raw deck text), job lifecycle, and simulation tracking. Uses factory pattern (`job-store-factory.ts`, `deck-store-factory.ts`) to swap SQLite/Firestore backends.
- **worker/** — Slim Node.js Docker image (~100MB). Pulls jobs via Pub/Sub (GCP) or HTTP polling (local). Orchestrates simulation containers via Docker socket, reports per-simulation progress, aggregates logs, POSTs results to API. Runs an HTTP server (port 9090) for push-based control: config updates, cancellation, job notification, and drain.
  - **worker/forge-engine/** — Headless Forge simulator assets: `run_sim.sh` entrypoint, precon decks in `precons/`.
- **simulation/** — Standalone Docker image (~750MB, Java 17 + Forge + xvfb). Runs exactly 1 game, writes log file, exits. Spawned by the worker via `docker run --rm`.

### Key Patterns

- **Factory pattern for storage**: `api/lib/*-factory.ts` files return SQLite or Firestore implementations based on mode. The API routes use these factories, never import concrete stores directly.
- **Worker + Simulation split**: Two Docker images. The worker (Node.js) orchestrates simulation containers (Java + Forge) with semaphore-bounded concurrency, auto-scaled by CPU/RAM. See `worker/src/worker.ts` for `processJobWithContainers`, `Semaphore`, and `calculateDynamicParallelism`.
- **Per-simulation tracking**: Individual simulation states (PENDING/RUNNING/COMPLETED/FAILED) tracked via Firestore subcollection or SQLite table, streamed to frontend via SSE.
- **Backward compatibility**: Worker auto-detects mode — container orchestration (default) or monolithic child processes (legacy, when `FORGE_PATH` is set).
- **Deck resolution**: Supports Moxfield URLs, precon names, and raw deck text. Resolution happens in `api/lib/deck-resolver.ts` + `api/lib/moxfield-service.ts`.
- **Push-based worker communication**: API pushes config overrides, cancellation commands, and job notifications to the worker's HTTP API (`worker/src/worker-api.ts`). Push helper lives in `api/lib/worker-push.ts`. Heartbeat remains for health monitoring and startup sync.

### Data Flow Documentation

`DATA_FLOW.md` is the source of truth for the end-to-end data flow from simulation completion through worker reporting, API aggregation, and frontend consumption.

**When modifying any of these areas, you MUST:**
1. Read DATA_FLOW.md first to understand the current flow
2. Update DATA_FLOW.md if your changes alter the data flow (new fields, changed endpoints, modified aggregation logic, new SSE events, etc.)
3. Ensure test coverage exists for the part of the flow you changed — see the test files listed in DATA_FLOW.md

Areas covered: worker result reporting, API status updates, log upload/storage, aggregation pipeline (condense + structure), SSE streaming, frontend log retrieval, race condition guards.

### Frontend Structure

- `src/App.tsx` — Router setup (react-router-dom v7)
- `src/pages/Home.tsx` — Main page: deck input, job creation
- `src/pages/JobStatus.tsx` — Job progress and results
- `src/contexts/AuthContext.tsx` — Firebase Auth provider
- `src/api.ts` — API client functions
- `src/config.ts` — Runtime config loader (reads `config.json`)

### API Routes

Routes live under `api/app/api/`. Key endpoints:
- `POST /api/jobs` — Create simulation job
- `GET /api/jobs/:id` — Job status and results
- `GET /api/jobs/:id/stream` — SSE stream for real-time job + simulation updates
- `GET /api/jobs/:id/simulations` — Per-simulation statuses
- `POST /api/jobs/:id/simulations` — Initialize simulation tracking (worker)
- `PATCH /api/jobs/:id/simulations/:simId` — Update simulation status (worker)
- Deck and precon CRUD endpoints

## Environment & Secrets

- `.env` files are gitignored; see `docs/MODE_SETUP.md` for required variables per mode
- `frontend/.env` needs Firebase config vars (see `frontend/.env.example`)
- `api/.env` needs for GCP mode: `GOOGLE_CLOUD_PROJECT`, `GCS_BUCKET`, `PUBSUB_TOPIC`, `WORKER_SECRET`
- Worker env: `WORKER_API_PORT` (default 9090) and `WORKER_API_URL` (externally reachable URL for push-based API control)
- Firebase deploy requires `FIREBASE_TOKEN` in GitHub Actions secrets
- `npm run populate-worker-secret` and `npm run populate-frontend-secret` manage GCP Secret Manager entries

### Sentry

Error tracking via `@sentry/nextjs` in `api/`. Graceful no-op when `SENTRY_DSN` is unset.

- **Runtime DSN**: `SENTRY_DSN` — set in `api/apphosting.yaml` via GCP Secret Manager (`sentry-dsn`)
- **API auth token** (for managing alerts, releases, source maps): stored in GCP Secret Manager as `sentry-auth-token`. Retrieve with:
  ```bash
  gcloud secrets versions access latest --secret=sentry-auth-token
  ```
  Also available in `api/.env` as `SENTRY_AUTH_TOKEN` for local use.
- **Sentry org/project**: `tytaniumdev` / `magic-bracket-api`
- **Alerts**: 4 alert rules configured with GitHub issue creation (labels: `bug`, `sentry`):
  - Error Spike (catch-all), Aggregation Failures (critical), TrueSkill Rating Failures, Backfill Rating Failures

## Lint & Type Checking

- Frontend uses ESLint 9 flat config with typescript-eslint, react-hooks, and react-refresh plugins. Zero warnings policy (`--max-warnings 0`).
- API lint is `tsc --noEmit` (type-check only, no ESLint).
- Both must pass in CI before merge.

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
