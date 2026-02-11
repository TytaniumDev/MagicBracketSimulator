# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

Magic Bracket Simulator: a tool for evaluating Magic: The Gathering Commander deck power levels (brackets 1-5) through automated Forge simulations and Gemini AI analysis.

## Build & Dev Commands

```bash
# Install all subproject dependencies (root, orchestrator, frontend, forge-log-analyzer)
npm run install:all

# Start everything locally (analysis-service:8000, log-analyzer:3001, orchestrator:3000, frontend:5173, worker)
npm run dev

# GCP mode (orchestrator + frontend only; run local worker separately)
npm run dev:gcp
npm run worker:gcp   # separate terminal
```

### Per-service commands

**Frontend** (Vite + React, `frontend/`):
```bash
npm run dev --prefix frontend          # dev server on :5173
npm run build --prefix frontend        # tsc -b && vite build
npm run lint --prefix frontend         # eslint, zero warnings allowed
```

**Orchestrator** (Next.js, `orchestrator-service/`):
```bash
npm run dev --prefix orchestrator-service     # next dev on :3000
npm run build --prefix orchestrator-service   # next build
npm run lint --prefix orchestrator-service    # tsc --noEmit (type-check only)
npm run worker --prefix orchestrator-service  # run the worker process
```

**Orchestrator tests** (all use `tsx` directly, no test framework):
```bash
npm run test:unit --prefix orchestrator-service        # game-logs.test.ts
npm run test:integration --prefix orchestrator-service # integration.test.ts
npm run test:ingestion --prefix orchestrator-service   # ingestion.test.ts
```

**Analysis Service** (Python + FastAPI, `analysis-service/`):
```bash
cd analysis-service && uv run uvicorn main:app --reload --port 8000
cd analysis-service && uv run pytest   # tests in tests/
```

**Forge Log Analyzer** (legacy local mode, `forge-log-analyzer/`):
```bash
npm run dev --prefix forge-log-analyzer   # tsx watch, :3001
npm run test --prefix forge-log-analyzer  # condenser + store tests
```

### CI

CI runs on PRs to `main` (.github/workflows/ci.yml): frontend lint+build, orchestrator lint+build+test:unit. Deploy workflow deploys frontend to Firebase Hosting after merge.

## Architecture

### Two Deployment Modes

Mode is auto-detected by `GOOGLE_CLOUD_PROJECT` env var:
- **LOCAL mode** (unset): SQLite, local filesystem, polling worker, analysis-service + forge-log-analyzer
- **GCP mode** (set): Firestore, Cloud Storage, Pub/Sub queue, Gemini API via orchestrator, simulation-worker + misc-runner Docker containers

### Service Boundaries

- **frontend/** — Vite + React + Tailwind v4 + Firebase Auth (Google sign-in). Calls orchestrator API and (in local mode) the log analyzer directly. Config in `frontend/public/config.json` (committed, not secret).
- **orchestrator-service/** — Next.js 15 app: API routes under `app/api/`, background worker in `worker/worker.ts`. Handles deck ingestion (Moxfield URLs, precon names, raw deck text), job lifecycle, and Gemini analysis. Uses factory pattern (`job-store-factory.ts`, `deck-store-factory.ts`, `worker-store-factory.ts`) to swap SQLite/Firestore backends.
- **forge-simulation-engine/** — Docker image `forge-sim`. Runs headless Forge MTG simulations under xvfb. Entrypoint: `run_sim.sh`. Precon decks in `precons/`.
- **simulation-worker/** — GCP mode only. Pulls Pub/Sub messages, orchestrates forge-sim + misc-runner Docker containers.
- **misc-runner/** — Go container for GCP mode. Condenses logs and uploads artifacts to GCS.
- **forge-log-analyzer/** — Legacy local-mode log service (Express). Exports condenser logic used by orchestrator.
- **analysis-service/** — Legacy local-mode Python FastAPI + Gemini AI bracket analysis.

### Key Patterns

- **Factory pattern for storage**: `orchestrator-service/lib/*-factory.ts` files return SQLite or Firestore implementations based on mode. The API routes and worker use these factories, never import concrete stores directly.
- **Worker parallelism**: One job at a time, but multiple Docker containers per job (1-16, default 4). Controlled by `FORGE_PARALLELISM` env or per-job `parallelism` param. See `worker/worker.ts` for `splitSimulations` and `processJob`.
- **Deck resolution**: Supports Moxfield URLs, precon names, and raw deck text. Resolution happens in `lib/deck-resolver.ts` + `lib/moxfield-service.ts`.

### Frontend Structure

- `src/App.tsx` — Router setup (react-router-dom v7)
- `src/pages/Home.tsx` — Main page: deck input, job creation
- `src/pages/JobStatus.tsx` — Job progress and results
- `src/contexts/AuthContext.tsx` — Firebase Auth provider
- `src/api.ts` — API client functions
- `src/config.ts` — Runtime config loader (reads `config.json`)

### Orchestrator API Routes

Routes live under `orchestrator-service/app/api/`. Key endpoints:
- `POST /api/jobs` — Create simulation job
- `GET /api/jobs/:id` — Job status and results
- `POST /api/jobs/:id/analyze` — Trigger Gemini analysis
- Deck and precon CRUD endpoints

## Environment & Secrets

- `.env` files are gitignored; see `MODE_SETUP.md` for required variables per mode
- `frontend/.env` needs Firebase config vars (see `frontend/.env.example`)
- `orchestrator-service/.env` needs `GEMINI_API_KEY`, and for GCP mode: `GOOGLE_CLOUD_PROJECT`, `GCS_BUCKET`, `PUBSUB_TOPIC`, `WORKER_SECRET`
- Firebase deploy requires `FIREBASE_TOKEN` in GitHub Actions secrets
- `npm run populate-worker-secret` and `npm run populate-frontend-secret` manage GCP Secret Manager entries

## Lint & Type Checking

- Frontend uses ESLint 9 flat config with typescript-eslint, react-hooks, and react-refresh plugins. Zero warnings policy (`--max-warnings 0`).
- Orchestrator lint is `tsc --noEmit` (type-check only, no ESLint).
- Both must pass in CI before merge.
