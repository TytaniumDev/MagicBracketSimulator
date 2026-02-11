# Scribe's Journal

## Critical Learnings

### Architectural Drift: Unified Worker vs Local Worker
*Date: 2024-05-22*
*Topic: GCP Architecture / Worker Pattern*

**The Drift:**
Documentation previously described the GCP architecture as a "Local Worker" (running on a VM) that orchestrates `forge-sim` Docker containers and `misc-runner` containers.

**The Reality:**
The GCP architecture uses a **Unified Worker** pattern.
- **Source:** `local-worker/` directory (name is legacy).
- **Artifact:** A single Docker image (`unified-worker/Dockerfile`) containing Node.js (worker), Java (Forge), and Xvfb.
- **Execution:** The worker runs simulations as *internal child processes* (`spawn('run_sim.sh')`), NOT by spawning Docker containers.
- **Log Processing:** The worker handles log condensation and GCS uploads internally (via `condenser.ts` and `gcs-client.ts`). The `misc-runner` container is obsolete in this flow.

**Why it matters:**
Developers trying to debug "Docker-in-Docker" issues on GCP will be confused because there is no Docker-in-Docker. It's a single monolithic container running multiple processes.

**Correction Strategy:**
Updated `docs/ARCHITECTURE.md` to reflect the Unified Worker pattern. `docs/MODE_SETUP.md` remains a known drift point regarding `misc-runner` build instructions.
