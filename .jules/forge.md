# Forge's Journal

## Critical Learnings
- **[2024-03-24]**: Initialized `AGENTS.md` as the SSOT for intent. Confirmed CI workflows (`ci.yml`, `deploy.yml`) use standard `npm ci` commands, but were missing tests for `analysis-service`, `forge-log-analyzer`, and build check for `worker`. Added parity scripts and updated CI.
- **[2026-02-08]**: Calibrated `AGENTS.md` and `scripts/run-install.js`. `npm run install:all` was missing `worker` dependencies, causing build failures. Updated script to include `worker`. Clarified `AGENTS.md` to distinguish between Node (automated via `install:all`) and Python (manual via `uv`) dependencies. Added missing `Build` command for `forge-log-analyzer` to `AGENTS.md`.
- **[2026-06-15]**: Removed obsolete Python/`uv` tooling from `AGENTS.md` as the project is now fully Node.js. Identified a gap where `worker` build checks were missing from `.github/workflows/ci.yml`. Added a `worker` job to `ci.yml` to run `npm ci` and `npm run build`, ensuring type safety and parity with `AGENTS.md` intent.
