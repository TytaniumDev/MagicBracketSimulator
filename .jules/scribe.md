# Scribe's Journal 📜

This file contains critical learnings and documentation philosophy for the Magic Bracket Simulator project.

## Scribe's Philosophy
- **Code is Truth, but Documentation is Understanding.**
- **Stale Documentation is worse than No Documentation.**
- **One Size Does Not Fit All:** Managers need concepts; Developers need implementation details.
- **Explicit is Better Than Implicit:** Especially regarding APIs and Cloud Configs.

## Critical Learnings

### 1. The Unified Worker vs. Legacy Architecture
The project has undergone a significant architectural shift in GCP Mode that was not reflected in the documentation:

- **Legacy Architecture (GCP):**
  - Described in old docs as `Local Worker` orchestrating `forge-sim` and `misc-runner` Docker containers.
  - Relied on Docker-in-Docker or mounting the Docker socket.
  - Used `misc-runner` for log condensing and uploading.

- **Current Architecture (GCP):**
  - Uses a **Unified Worker** (`local-worker` source code, packaged via `unified-worker/Dockerfile`).
  - Runs as a **single container** (or process) that includes Node.js, Java, and Forge.
  - Executes Forge simulations as **child processes** (using `spawn` and `run_sim.sh`), NOT by spawning external Docker containers.
  - Handles log condensing and GCS uploads internally (no separate `misc-runner`).
  - This simplifies deployment significantly by removing the need for Docker orchestration privileges.

### 2. Deployment Modes
- **Local Mode:** Still uses `orchestrator-service`'s internal worker to spawn `forge-sim` Docker containers. This remains unchanged.
- **GCP Mode:** Uses the Unified Worker (as described above).

### 3. Documentation Drift
- `docs/ARCHITECTURE.md` and `docs/MODE_SETUP.md` were heavily drifted, describing the legacy `misc-runner` approach.
- The `local-worker` source code (`src/worker.ts`) explicitly states it replaces `misc-runner`.

## Daily Process
1. **SCAN:** Detect documentation drift.
2. **SELECT:** Choose the most critical gap.
3. **DRAFT:** Write with precision.
4. **VERIFY:** Integrity check.
5. **PRESENT:** Submit the update.
