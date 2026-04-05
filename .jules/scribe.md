# Scribe's Journal

## Critical Learnings

- **2026-02-19:** Detected stale documentation in `MODE_SETUP.md` regarding Docker Swarm. Code analysis of `worker/src/worker.ts` confirmed `docker run` usage, matching `ARCHITECTURE.md`. Documentation must be cross-verified against source code.
- **2026-03-25:** Detected drift in `ARCHITECTURE.md` regarding the Pub/Sub delivery mechanism. The architecture transitioned from publishing a single "job-created" message (with the worker orchestrating multiple simulations locally) to publishing N individual "simulation-task" messages. This per-simulation message pattern improves concurrency control (`simSemaphore`) and reduces stale redeliveries of long-running job tasks.
