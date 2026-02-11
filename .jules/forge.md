# Forge's Journal

## Critical Learnings
- **[2024-03-24]**: Initialized `AGENTS.md` as the SSOT for intent. Confirmed CI workflows (`ci.yml`, `deploy.yml`) use standard `npm ci` commands, but were missing tests for `analysis-service`, `forge-log-analyzer`, and build check for `local-worker`. Added parity scripts and updated CI.
- **[2026-02-08]**: Calibrated `AGENTS.md` and `scripts/run-install.js`. `npm run install:all` was missing `local-worker` dependencies, causing build failures. Updated script to include `local-worker`. Clarified `AGENTS.md` to distinguish between Node (automated via `install:all`) and Python (manual via `uv`) dependencies. Added missing `Build` command for `forge-log-analyzer` to `AGENTS.md`.
- **[2026-02-11]**: Calibrated `AGENTS.md`. Added `Lint` and `Format` commands for `analysis-service` (via `ruff`) to align with `pyproject.toml` dev dependencies. Added `Dev` command for `local-worker` to provide a complete development lifecycle reference. Verified `ruff` commands execute successfully.
