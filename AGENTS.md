# AGENTS.md

## Philosophy
- **Intent SSOT:** This file is the Single Source of Truth for *intent*.
- **Execution SSOT:** The CI pipeline is the Source of Truth for *execution*.
- **Executable:** If it isn't an executable command or a hard constraint, it doesn't belong here.
- **Architecture:** `CLAUDE.md` (conventions), `docs/ARCHITECTURE.md` (system map) and `DATA_FLOW.md` (dispatch, reporting, aggregation). Read `DATA_FLOW.md` before changing any part of that flow, and update it in the same change.

## Tooling
- **Node.js**: 20 (managed by `npm`)
- **Flutter**: stable channel, for `worker_flutter/`

## Setup
- **Install Node Dependencies**: `npm run install:all`
- **Start Dev Server**: `npm run dev`
- **Install Flutter Dependencies**: `cd worker_flutter && flutter pub get`

## Testing & Verification
### Global Commands (CI Parity)
- **Lint All**: `./scripts/lint.sh`
- **Build All**: `./scripts/build.sh`
- **Test All**: `./scripts/test.sh`

### Targeted Commands
- **Frontend Lint**: `cd frontend && npm run lint`
- **Frontend Test**: `cd frontend && npm test`
- **API Lint**: `cd api && npm run lint`
- **API Unit Test**: `cd api && npm run test:unit`
- **API Ingestion Test**: `cd api && npm run test:ingestion`
- **Desktop Worker Analyze**: `cd worker_flutter && flutter analyze --no-fatal-infos`
- **Desktop Worker Test**: `cd worker_flutter && flutter test`

## Hard Constraints
- Every caught error is reported to Sentry; never swallow one silently.
- Clients only read Firestore, and only approved users. Every write goes through the API (worker presence in Realtime Database is the one exception).
- No backwards-compat or migration code for data shapes. After a SQLite schema change, delete `api/data/jobs.db`.
- The API runs on one 1 GiB instance: never hold more than one job's raw logs in memory.

## Deployment
- **CI**: `.github/workflows/ci.yml` and `.github/workflows/worker-flutter-ci.yml` (run on PR)
- **Deploy**: `.github/workflows/deploy.yml` (frontend, Firestore and Realtime Database rules, on push to main); the API deploys through Firebase App Hosting from `main`
- **Desktop worker**: `.github/workflows/release-worker.yml` (GitHub Release + `appcast.xml`)
- **Forge updates**: `.github/workflows/forge-update.yml` (nightly; opens an auto-merging PR that bumps `worker_flutter/forge-manifest.json`)

## Project Structure
- `frontend/`: React app (Firebase Hosting)
- `api/`: Next.js API on Firebase App Hosting: ingestion, jobs, sim claiming, aggregation, stats
- `shared/types/`: Types shared by api and frontend
- `worker_flutter/`: Desktop worker (macOS, Windows), cloud and offline modes; the only worker
