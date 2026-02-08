# SCRIBE'S JOURNAL - CRITICAL LEARNINGS

This document records architectural quirks and documentation drift hazards discovered by Scribe.
Use this to prevent future drift and confusion.

---

## 1. The "Dual Mode" Architecture Split

**Hazard:** The repository supports two distinct architectures that share *some* code but diverge significantly in execution. Documentation often conflates them.

*   **Local Development Mode:**
    *   **Orchestrator:** Next.js app running locally.
    *   **Worker:** Internal to Orchestrator (`orchestrator-service/worker/worker.ts`). Spawns `docker run forge-sim`.
    *   **Analysis:** Uses `forge-log-analyzer` (Express) and `analysis-service` (Python/FastAPI). Logs are stored on disk.
    *   **Key Drift:** The frontend sometimes points to Orchestrator for analysis (GCP style) but the backend expects the old Log Analyzer flow.

*   **GCP Cloud Mode:**
    *   **Orchestrator:** Cloud Run service. Pushes jobs to Pub/Sub.
    *   **Worker:** "Unified Worker" (`local-worker/`). Runs in a container. Pulls from Pub/Sub.
    *   **Execution:** Does *not* spawn Docker containers. Runs simulations directly as child processes (`run_sim.sh`).
    *   **Analysis:** Orchestrator fetches logs from GCS and performs analysis internally (using `lib/gemini.ts`).

## 2. Naming Confusion: "Local Worker" vs "Unified Worker"

**Hazard:** The directory `local-worker/` is named misleadingly.
*   **Reality:** It is the *Cloud Worker* code. It is designed to run in a container on a machine (local or VM) that pulls from Pub/Sub. It is "local" only in the sense that it runs on a "local" machine relative to the Cloud API, but it is the *production* worker for GCP mode.
*   **Confusion:** The *actual* local development worker is inside `orchestrator-service/worker/`.

## 3. The "Misc Runner" Ghost

**Hazard:** Old documentation references `misc-runner` as a separate service for log condensation.
*   **Reality:** `misc-runner` functionality (log condensation, GCS upload) has been absorbed into the `local-worker` code. It no longer exists as a standalone service in the GCP flow.
