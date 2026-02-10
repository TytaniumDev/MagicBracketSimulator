# Mode Setup Guide

This project supports two operational modes: **LOCAL** and **GCP**. This guide explains each mode and how to run the system.

## Mode Overview

| Feature | LOCAL Mode | GCP Mode |
|---------|------------|----------|
| Database | SQLite | Firestore |
| File Storage | Local filesystem | Cloud Storage (GCS) |
| Job Queue | Polling-based worker | Pub/Sub |
| Analysis | analysis-service + forge-log-analyzer | Gemini API (via Orchestrator) |
| Worker | orchestrator-service/worker (Docker orchestration) | unified-worker (Single container) |

## Mode Detection

The system automatically detects the mode based on the `GOOGLE_CLOUD_PROJECT` environment variable:
- **Set**: GCP mode (Firestore, Pub/Sub, GCS)
- **Not set**: LOCAL mode (SQLite, filesystem)

At startup, you'll see log messages like:
```
[Job Store] Running in GCP mode
[Job Store] Project: magic-bracket-simulator
[Job Store] Using: Firestore + Cloud Storage + Pub/Sub
```

---

## GCP Mode Setup

### Prerequisites
1. GCP Project with:
   - Firestore database
   - Cloud Storage bucket
   - Pub/Sub topic and subscription
2. Service account key with permissions for Firestore, GCS, and Pub/Sub
3. Gemini API key (for AI analysis)
4. Docker installed (to run the Unified Worker container locally)

### Configuration Files

#### orchestrator-service/.env
```bash
GOOGLE_CLOUD_PROJECT="magic-bracket-simulator"
GCS_BUCKET="magic-bracket-simulator-artifacts"
PUBSUB_TOPIC="job-created"
GEMINI_API_KEY="your-gemini-api-key"
GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account-key.json"
WORKER_SECRET="shared-secret-for-worker-auth"
NODE_ENV="development"
# FORGE_ENGINE_PATH is only needed for Local Mode worker, not GCP Orchestrator
```

#### local-worker/.env
*(Only needed if running `npm run worker:gcp` locally with manual Forge setup. The Docker container uses env vars passed via docker-compose)*

```bash
GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account-key.json"
GOOGLE_CLOUD_PROJECT="magic-bracket-simulator"
PUBSUB_SUBSCRIPTION="job-created-worker"
GCS_BUCKET="magic-bracket-simulator-artifacts"
API_URL="http://localhost:3000"  # or Cloud Run URL
JOBS_DIR="./jobs"
WORKER_SECRET="shared-secret-for-worker-auth"
FORGE_PATH="/path/to/forge/installation" # Required if not in Docker
```

### Running GCP Mode

**Terminal 1: Orchestrator + Frontend**
```bash
npm run dev:gcp
```

**Terminal 2: Unified Worker (processes jobs via Pub/Sub)**

Recommended: Run the worker in its Docker container (comes with Forge pre-installed).

```bash
# 1. Update unified-worker/docker-compose.yml environment variables or create .env
# 2. Start the worker container
cd unified-worker
docker compose up --build
```

*Alternative (Advanced):* Run the worker directly on your machine.
**Requirement:** You must have Forge installed and set `FORGE_PATH` in `local-worker/.env`.
```bash
npm run worker:gcp
```

### Services in GCP Mode

| Service | Purpose | Where it runs |
|---------|---------|---------------|
| orchestrator-service | API backend, Firestore/Pub/Sub integration | Local or Cloud Run |
| frontend | React UI | Local or Firebase Hosting |
| unified-worker | Receives Pub/Sub messages, runs simulations internally | Docker (local or Cloud Run) |

---

## LOCAL Mode Setup

### Prerequisites
1. Node.js 18+
2. Docker (for `forge-sim` container)
3. No GCP configuration needed

### Configuration
Simply ensure `GOOGLE_CLOUD_PROJECT` is **not set** in `orchestrator-service/.env`, or delete the `.env` file.

### Running LOCAL Mode
```bash
npm run dev:local
# or just
npm run dev
```

### Services in LOCAL Mode

| Service | Purpose |
|---------|---------|
| orchestrator-service | API backend with SQLite |
| frontend | React UI |
| analysis-service | OpenAI analysis |
| forge-log-analyzer | Log processing |
| worker (polling) | Polls orchestrator for jobs |
| forge-sim (Docker) | Runs simulations (spawned by worker) |

---

## Seeding Precons

Before using GCP mode, seed the precon decks to Firestore:

```bash
cd orchestrator-service
export $(grep -v '^#' .env | xargs)
npx tsx scripts/seed-decks.ts
```

This loads all precon deck files from `forge-simulation-engine/precons/` into Firestore.

---

## Docker Images (Local Mode)

For **Local Mode**, you must build the `forge-sim` image:

```bash
cd forge-simulation-engine
docker build -t forge-sim:latest .
```

For **GCP Mode**, the `unified-worker` image is built automatically by `docker compose up` (or manually via `unified-worker/Dockerfile`).

---

## Troubleshooting

### "Running in LOCAL mode" when expecting GCP
- Check that `GOOGLE_CLOUD_PROJECT` is set in `orchestrator-service/.env`
- Ensure the .env file is being loaded (Next.js loads it automatically)

### Worker can't connect to API
- Verify `API_URL` in `local-worker/.env` (or docker-compose environment)
- For local testing, use `http://localhost:3000`
- For Cloud Run, use the deployed URL

### Pub/Sub messages not received
- Check `PUBSUB_SUBSCRIPTION` matches the subscription name in GCP
- Verify service account has `pubsub.subscriber` permission

### Firestore permission errors
- Ensure service account key path is correct
- Verify service account has Firestore read/write permissions

### Jobs stuck in QUEUED
- Ensure unified-worker is running and connected to Pub/Sub
- Check worker logs for errors
- Verify `WORKER_SECRET` matches between orchestrator and worker
