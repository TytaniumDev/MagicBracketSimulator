# Scribe's Journal

## Critical Learnings

- **2026-02-19:** Detected stale documentation in `MODE_SETUP.md` regarding Docker Swarm. Code analysis of `worker/src/worker.ts` confirmed `docker run` usage, matching `ARCHITECTURE.md`. Documentation must be cross-verified against source code.

- **2026-03-25:** Identified a recurring codebase pattern regarding URL validation. All user-provided URLs must use the `new URL()` constructor and explicitly check for `http:` or `https:` protocols rather than relying on regex expressions. Standardized this pattern in `CONTRIBUTING.md`.
