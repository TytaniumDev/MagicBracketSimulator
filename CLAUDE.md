# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

Magic Bracket Simulator: a tool for evaluating Magic: The Gathering Commander deck power levels (brackets 1-5) through automated Forge simulations and Gemini AI analysis.

## Build & Dev Commands

```bash
# Install all subproject dependencies (root, api, frontend, worker)
npm run install:all

# Start locally (api:3000, frontend:5173; run worker separately via Docker)
npm run dev
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

### CI

CI runs on PRs to `main` (.github/workflows/ci.yml): frontend lint+build, api lint+build+test:unit. Deploy workflow deploys frontend to Firebase Hosting after merge.

## Architecture

### Two Deployment Modes

Mode is auto-detected by `GOOGLE_CLOUD_PROJECT` env var:
- **LOCAL mode** (unset): SQLite, local filesystem, polling worker, no Firebase auth
- **GCP mode** (set): Firestore, Cloud Storage, Pub/Sub queue, Gemini API via api, unified Docker worker

### Service Boundaries

- **frontend/** — Vite + React + Tailwind v4 + Firebase Auth (Google sign-in). Calls the API over HTTP. Config in `frontend/public/config.json` (committed, not secret).
- **api/** — Next.js 15 app: API routes under `app/api/`. Handles deck ingestion (Moxfield URLs, precon names, raw deck text), job lifecycle, and Gemini analysis. Uses factory pattern (`job-store-factory.ts`, `deck-store-factory.ts`) to swap SQLite/Firestore backends.
- **worker/** — Unified Docker image. Pulls jobs via Pub/Sub (GCP) or HTTP polling (local). Runs Forge simulations as child processes, condenses logs, POSTs results to API.
  - **worker/forge-engine/** — Headless Forge simulator assets: `run_sim.sh` entrypoint, precon decks in `precons/`.

### Key Patterns

- **Factory pattern for storage**: `api/lib/*-factory.ts` files return SQLite or Firestore implementations based on mode. The API routes use these factories, never import concrete stores directly.
- **Worker parallelism**: One job at a time, but multiple Forge child processes per job (auto-scaled by CPU/RAM). See `worker/src/worker.ts` for `splitSimulations` and `processJob`.
- **Deck resolution**: Supports Moxfield URLs, precon names, and raw deck text. Resolution happens in `api/lib/deck-resolver.ts` + `api/lib/moxfield-service.ts`.

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
- `POST /api/jobs/:id/analyze` — Trigger Gemini analysis
- Deck and precon CRUD endpoints

## Environment & Secrets

- `.env` files are gitignored; see `docs/MODE_SETUP.md` for required variables per mode
- `frontend/.env` needs Firebase config vars (see `frontend/.env.example`)
- `api/.env` needs `GEMINI_API_KEY`, and for GCP mode: `GOOGLE_CLOUD_PROJECT`, `GCS_BUCKET`, `PUBSUB_TOPIC`, `WORKER_SECRET`
- Firebase deploy requires `FIREBASE_TOKEN` in GitHub Actions secrets
- `npm run populate-worker-secret` and `npm run populate-frontend-secret` manage GCP Secret Manager entries

## Lint & Type Checking

- Frontend uses ESLint 9 flat config with typescript-eslint, react-hooks, and react-refresh plugins. Zero warnings policy (`--max-warnings 0`).
- API lint is `tsc --noEmit` (type-check only, no ESLint).
- Both must pass in CI before merge.
