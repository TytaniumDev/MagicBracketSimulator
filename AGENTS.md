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
- **Install Node Dependencies**: `npm run install:all` (Use this instead of standard `npm install`)
- **Start Dev Server**: `npm run dev`

## Testing & Verification
For executing test, lint, and build commands (which require `cd` into the subdirectories), please refer to the comprehensive guide in:
- **[Testing Documentation](docs/TESTING.md)**

## Deployment
- **CI**: `.github/workflows/ci.yml` (Runs on PR)
- **Deploy**: `.github/workflows/deploy.yml` (Runs on push to main)

## Project Structure
- `frontend/`: React app
- `api/`: Next.js API, ingestion, and analysis
- `worker/`: Node.js + Docker simulation runner
