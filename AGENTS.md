# AGENTS.md

## Philosophy
- **Intent SSOT:** This file is the Single Source of Truth for *intent*.
- **Execution SSOT:** The CI pipeline is the Source of Truth for *execution*.
- **Executable:** If it isn't an executable command or a hard constraint, it doesn't belong here.

## Tooling
- **Node.js**: 20+ (managed by `npm`)
- **Flutter**: Stable channel (managed by `flutter`)
- **Docker**: Required for simulation engine
- **Package Manager**: `npm` (Node), `pub` (Flutter)

## Setup
- **Install Node Dependencies**: `npm run install:all`
- **Install Flutter Dependencies**: `cd worker_flutter && flutter pub get`
- **Start Dev Server**: `npm run dev`

## Testing & Verification
### Global Commands (CI Parity)
- **Lint All**: `./scripts/lint.sh`
- **Build All**: `./scripts/build.sh`
- **Test All**: `./scripts/test.sh`

### Targeted Commands
- **Frontend Test**: `cd frontend && npm test`
- **API Unit Test**: `cd api && npm run test:unit`
- **API Ingestion Test**: `cd api && npm run test:ingestion`
- **Worker Unit Test**: `cd worker && npm run test:unit`
- **Worker Flutter Lint**: `cd worker_flutter && flutter analyze --no-fatal-infos`
- **Worker Flutter Test**: `cd worker_flutter && flutter test`
- **Worker Build**: `cd worker && npm run build`
- **Worker Install**: `cd worker && npm install`
- **Worker Dev**: `cd worker && npm run dev`
- **Worker Test**: `cd worker && npm run test:unit`

## Deployment
- **CI**: `.github/workflows/ci.yml` (Runs on PR)
- **Deploy**: `.github/workflows/deploy.yml` (Runs on push to main)

## Project Structure
- `frontend/`: React app
- `api/`: Next.js API, ingestion, and analysis
- `worker/`: Node.js + Docker simulation runner
- `worker_flutter/`: Cross-platform desktop worker for Magic Bracket Simulator
