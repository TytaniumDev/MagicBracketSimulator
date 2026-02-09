# Scribe's Journal

## 2024-05-22 - Architectural Drift Detected
- **Black Box:** The `local-worker` in GCP mode was documented as an orchestrator of Docker containers (Docker-in-Docker style), but the code reveals it executes simulations directly as child processes via `spawn`.
- **Correction:** Updated `ARCHITECTURE.md` to reflect that `local-worker` is a "Unified Worker" that handles simulation execution, log condensing, and GCS uploading in a single Node.js process.
- **Legacy Artifacts:** `misc-runner` appears to be superseded by the logic integrated into `local-worker`.
