# Scribe's Journal

## Critical Learnings

### Architecture Shift: Unified Worker
The system has migrated from a multi-container Docker orchestration (where a "Worker" container spawned sibling `forge-sim` containers or `misc-runner` containers) to a **Unified Worker** model.
- **Old:** `worker` (Node) -> Docker Socket -> `forge-sim` (Java) + `misc-runner` (Go).
- **New:** `worker` (Node) runs in a single container (based on `eclipse-temurin:17-jre-jammy` + Node 20) and spawns Forge simulations as internal child processes (`spawn`).
- **Impact:** No Docker-in-Docker required for the worker itself (though the worker runs *inside* a container in GCP).

### Service Removal: Decommissioned Components
- **`misc-runner`**: The Go-based log condenser and GCS uploader has been removed. Its functionality (log condensing, structuring) is now handled by the **API** (`api/lib/log-store.ts`) upon receiving raw logs from the worker.
- **`analysis-service`**: The Python-based Gemini analysis service (using `uv`) has been removed.
- **`forge-log-analyzer`**: Legacy local log analyzer is fully deprecated/removed.

### Analysis Logic: API-Side Intelligence
Gemini analysis logic has moved from the external Python service to the core **Next.js API** (`api/lib/gemini.ts`).
- **Flow:** The API generates the prompt using the `rubric.md` and sends it directly to Google Generative AI via the Node.js SDK (`@google/generative-ai`).

### Orphaned Code
- **`scripts/run-analysis.js`**: This script attempts to run `uv run uvicorn` in `analysis-service/`, a directory that no longer exists. It is currently dead code.
