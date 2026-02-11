# Forge's Journal

## Critical Learnings
- **[2024-03-24]**: Initialized `AGENTS.md` as the SSOT for intent. Confirmed CI workflows (`ci.yml`, `deploy.yml`) use standard `npm ci` commands, but were missing tests for `analysis-service`, `forge-log-analyzer`, and build check for `simulation-worker`. Added parity scripts and updated CI.
- **[2026-02-08]**: Calibrated `AGENTS.md` and `scripts/run-install.js`. `npm run install:all` was missing `simulation-worker` dependencies, causing build failures. Updated script to include `simulation-worker`. Clarified `AGENTS.md` to distinguish between Node (automated via `install:all`) and Python (manual via `uv`) dependencies. Added missing `Build` command for `forge-log-analyzer` to `AGENTS.md`.
