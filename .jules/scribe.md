# Scribe's Journal

## Critical Learnings

- **2026-02-19:** Detected stale documentation in `MODE_SETUP.md` regarding Docker Swarm. Code analysis of `worker/src/worker.ts` confirmed `docker run` usage, matching `ARCHITECTURE.md`. Documentation must be cross-verified against source code.
- **2026-05-21:** Detected `API.md` was orphaned in the root directory and severely outdated (missing 10+ endpoints). Moved to `docs/API.md` and updated based on route analysis. Documentation files should be centralized in `docs/` to maintain a clean root.
- **2026-05-21:** `CONTRIBUTING.md` stated frontend had no tests, but `frontend/package.json` and `vitest` presence proved otherwise. Always verify `package.json` scripts before documenting testing procedures.
