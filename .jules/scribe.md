# Scribe's Journal

This journal records architectural drifts, documentation gaps, and critical learnings.

## Architectural Corrections

### Unified Worker vs Legacy Docker Orchestration
**Date:** 2025-05-23
**Observation:** `docs/ARCHITECTURE.md` and `docs/MODE_SETUP.md` described a legacy GCP architecture where a `local-worker` Node.js process orchestrated multiple `forge-sim` and `misc-runner` Docker containers.
**Correction:** The codebase implements a "Unified Worker" model (`unified-worker/Dockerfile`, `local-worker/src/worker.ts`) where a single container includes both the Node.js worker and the Java/Forge runtime. Simulations are executed as internal child processes (`spawn` via `run_sim.sh`) directly on the worker, bypassing Docker-in-Docker complexity. Log condensing and GCS uploads are handled directly by the worker code, rendering `misc-runner` obsolete in this mode.
