# Scribe's Journal 📜

## Critical Architectural Learnings

### Dual Mode Architecture (Local vs GCP)
**Detected:** 2025-02-18
**Context:** This repo supports two distinct deployment modes that share some components but use completely different services for others.
- **Local Mode (Default):** Uses `analysis-service` (Python/Gemini) and `forge-log-analyzer` (TS) alongside the Orchestrator and Frontend. Uses SQLite for storage.
- **GCP Mode:** Uses `misc-runner` (Go) and `local-worker` instead of the legacy services. Uses Firestore, Pub/Sub, and Cloud Storage.
**Drift Risk:** High. `README.md` tends to describe Local Mode by default. `ARCHITECTURE.md` tends to describe GCP Mode as "recommended". New features must specify if they work in one or both modes.
