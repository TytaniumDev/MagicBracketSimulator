# AGENTS.md

## Philosophy
- **Intent SSOT:** This file is the Single Source of Truth for *intent*.
- **Execution SSOT:** The CI pipeline is the Source of Truth for *execution*.
- **Executable:** If it isn't an executable command or a hard constraint, it doesn't belong here.

## Tooling
- **Node.js**: 20+ (managed by `npm`)
- **Docker**: Required for simulation engine
- **Package Manager**: `npm` (Node)

## Setup
- **Install Node Dependencies**: `npm run install:all`
- **Start Dev Server**: `npm run dev`

## Testing & Verification
### Frontend
- **Lint**: `cd frontend && npm run lint`
- **Build**: `cd frontend && npm run build`
- **Test**: `cd frontend && npm test`

### API
- **Lint**: `cd api && npm run lint`
- **Build**: `cd api && npm run build`
- **Test**: `cd api && npm run test:unit`
- **Test (Ingestion)**: `cd api && npm run test:ingestion`

### Simulation Worker
- **Build**: `cd worker && npm run build`

## Deployment
- **CI**: `.github/workflows/ci.yml` (Runs on PR)
- **Deploy**: `.github/workflows/deploy.yml` (Runs on push to main)

## Project Structure
- `frontend/`: React app
- `api/`: Next.js API, ingestion, and analysis
- `worker/`: Node.js + Docker simulation runner
