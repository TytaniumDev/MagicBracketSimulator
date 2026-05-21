# Scribe's Journal

## Critical Learnings

- **2026-02-19:** Detected stale documentation in `MODE_SETUP.md` regarding Docker Swarm. Code analysis of `worker/src/worker.ts` confirmed `docker run` usage, matching `ARCHITECTURE.md`. Documentation must be cross-verified against source code.
- **2026-03-25:** Detected drift in `ARCHITECTURE.md` regarding the Pub/Sub delivery mechanism. The architecture transitioned from publishing a single "job-created" message (with the worker orchestrating multiple simulations locally) to publishing N individual "simulation-task" messages. This per-simulation message pattern improves concurrency control (`simSemaphore`) and reduces stale redeliveries of long-running job tasks.

- **2026-03-25:** Identified a recurring codebase pattern regarding URL validation. All user-provided URLs must use the `new URL()` constructor and explicitly check for `http:` or `https:` protocols rather than relying on regex expressions. Standardized this pattern in `CONTRIBUTING.md`.

- **2026-05-19:** Detected remaining stale documentation regarding Pub/Sub. The architecture fully transitioned to HTTP polling (per-sim claim via `claim-sim`), but `MODE_SETUP.md`, `SECRETS_SETUP.md`, `DEPLOYMENT.md`, and `worker/README.md` still contained legacy references to `PUBSUB_SUBSCRIPTION`, `PUBSUB_TOPIC`, and Pub/Sub IAM roles. Removed all Pub/Sub mentions to match the codebase execution reality.
