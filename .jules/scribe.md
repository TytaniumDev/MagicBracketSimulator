# Scribe's Journal

## Critical Learnings

### ⚠️ Hybrid Architecture Drift (Local vs GCP)

**Date:** 2025-05-23
**Discovery:**
The repository is in a confusing "Half-Migrated" state between an original Local Architecture and a new GCP-native Architecture. This causes significant drift between documentation, code, and runtime behavior.

- **Local Mode (Default `npm run dev`):**
  - Starts "Legacy" services (`analysis-service` Python, `forge-log-analyzer`) that are effectively dead code because the frontend is configured to talk to the Orchestrator for analysis.
  - The Orchestrator is missing the endpoint (`/api/jobs/[id]/analyze`) that the frontend expects.
  - Result: The "Analyze" feature is broken in Local Mode despite all services running.

- **GCP Mode:**
  - Designed to use `Cloud Run` + `Firestore` + `Pub/Sub`.
  - Also relies on the Orchestrator's `analyze` endpoint, which is missing.

**Scribe's Advice:**
- When documenting "Architecture", explicit distinction must be made between "What runs" (processes) and "What works" (connected data flows).
- Be wary of "Legacy" labels in docs; sometimes legacy code is the *only* running code, even if broken.
