# Scribe's Journal

## Documentation Drift Log
*This file tracks areas where code reality has diverged from documentation.*

### 2024-05-21 - Unified Worker Architecture
**Drift Detected:** The `local-worker` has evolved into a "Unified Worker" that executes simulations as child processes and handles log condensing internally.
**Correction:** Updated `ARCHITECTURE.md` and `DEPLOYMENT.md` to remove references to `misc-runner` and Docker-in-Docker for GCP mode.
