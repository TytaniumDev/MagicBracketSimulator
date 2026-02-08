# Scribe's Journal

## Architectural Quirks
- **Unified Worker vs Local Worker**: The `local-worker` directory contains the source code for what is effectively the "Unified Worker". The `unified-worker` directory contains the Docker configuration to package this code with the Forge runtime. The `ARCHITECTURE.md` previously described `local-worker` as an orchestrator of Docker containers, but the code shows it now runs simulations as child processes directly.
- **Misc Runner Integration**: The functionality of `misc-runner` (log condensing and uploading) has been integrated into `local-worker/src/worker.ts`, rendering the standalone `misc-runner` container largely redundant for the unified worker flow.

## Documentation Dead Zones
- **`unified-worker` directory**: Completely undocumented in `ARCHITECTURE.md`.
- **Legacy Status**: `forge-log-analyzer` and `analysis-service` are present but likely legacy/unused in the GCP/Unified architecture.
