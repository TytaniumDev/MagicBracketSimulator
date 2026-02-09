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
- **Install Dependencies**: `npm run install:all` (Handles Node & Root)
- **Install Python Deps**: `cd analysis-service && uv sync --extra dev` (If not using script)
- **Start Dev Server**: `npm run dev`

## Testing & Verification
### Frontend
- **Lint**: `npm run lint --prefix frontend`
- **Build**: `npm run build --prefix frontend`

### Orchestrator Service
- **Lint**: `npm run lint --prefix orchestrator-service`
- **Build**: `npm run build --prefix orchestrator-service`
- **Test**: `npm run test:unit --prefix orchestrator-service`

### Analysis Service
- **Test (SSOT)**: `cd analysis-service && ../scripts/ci-analysis.sh`

### Log Analyzer
- **Dev**: `npm run dev --prefix forge-log-analyzer`
- **Build**: `npm run build --prefix forge-log-analyzer`
- **Test**: `npm run test --prefix forge-log-analyzer`

### Local Worker
- **Build**: `npm run build --prefix local-worker`

## Deployment
- **CI**: `.github/workflows/ci.yml` (Runs on PR)
- **Deploy**: `.github/workflows/deploy.yml` (Runs on push to main)

## Project Structure
- `frontend/`: React app
- `orchestrator-service/`: Next.js API & ingestion
- `analysis-service/`: Python/Gemini power analysis
- `local-worker/`: Docker simulation runner
- `forge-log-analyzer/`: TypeScript log parser
