# AGENTS.md

## Philosophy
- **Intent SSOT:** This file is the Single Source of Truth for *intent*.
- **Execution SSOT:** The CI pipeline is the Source of Truth for *execution*.
- **Executable:** If it isn't an executable command or a hard constraint, it doesn't belong here.

## Tooling
- **Node.js**: 20+ (managed by `npm`)
- **Python**: 3.11+ (managed by `uv`)
- **Docker**: Required for simulation engine
- **Package Manager**: `npm` (Node), `uv` (Python)

## Setup
- **Install Node Dependencies**: `npm run install:all`
- **Start Dev Server**: `npm run dev`

## Testing & Verification
### Frontend
- **Lint**: `npm run lint --prefix frontend`
- **Build**: `npm run build --prefix frontend`

### API
- **Lint**: `npm run lint --prefix api`
- **Build**: `npm run build --prefix api`
- **Test**: `npm run test:unit --prefix api`

### Simulation Worker
- **Build**: `npm run build --prefix worker`

## Deployment
- **CI**: `.github/workflows/ci.yml` (Runs on PR)
- **Deploy**: `.github/workflows/deploy.yml` (Runs on push to main)

## Project Structure
- `frontend/`: React app
- `api/`: Next.js API, ingestion, and analysis
- `worker/`: Docker simulation runner
