# Mode Setup Guide

This project supports two operational modes: **LOCAL** and **GCP**. This guide explains each mode and how to run the system.

## Mode Overview

| Feature | LOCAL Mode | GCP Mode |
|---------|------------|----------|
| Database | SQLite | Firestore |
| File Storage | Local filesystem | Cloud Storage (GCS) |
| Job Queue | Polling-based worker | Pub/Sub |
| Analysis | analysis-service + forge-log-analyzer | Gemini API + misc-runner |
| Worker | orchestrator-service/worker | simulation-worker (Pub/Sub subscriber) |

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
4. Docker installed (for simulation-worker)

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
FORGE_ENGINE_PATH="../forge-simulation-engine"
```

#### simulation-worker/.env
```bash
GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account-key.json"
GOOGLE_CLOUD_PROJECT="magic-bracket-simulator"
PUBSUB_SUBSCRIPTION="job-created-worker"
GCS_BUCKET="magic-bracket-simulator-artifacts"
API_URL="http://localhost:3000"  # or Cloud Run URL
FORGE_SIM_IMAGE="forge-sim:latest"
MISC_RUNNER_IMAGE="misc-runner:latest"
JOBS_DIR="./jobs"
WORKER_SECRET="shared-secret-for-worker-auth"
```

### Running GCP Mode

**Terminal 1: Orchestrator + Frontend**
```bash
npm run dev:gcp
```

**Terminal 2: Local Worker (processes jobs via Pub/Sub)**
```bash
npm run worker:gcp
```

### Services in GCP Mode

| Service | Purpose | Where it runs |
|---------|---------|---------------|
| orchestrator-service | API backend, Firestore/Pub/Sub integration | Local or Cloud Run |
| frontend | React UI | Local or Firebase Hosting |
| simulation-worker | Receives Pub/Sub messages, runs Docker containers | Your machine |
| forge-sim | MTG simulation engine | Docker (via simulation-worker) |
| misc-runner | Log condensing, GCS uploads | Docker (via simulation-worker) |

---

## LOCAL Mode Setup

### Prerequisites
1. Node.js 18+
2. No GCP configuration needed

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

## Docker Images

Build the Docker images required for simulation-worker:

```bash
# Build forge-sim
cd forge-simulation-engine
docker build -t forge-sim:latest .

# Build misc-runner
cd ../misc-runner
docker build -t misc-runner:latest .
```

Verify images exist:
```bash
docker images | grep -E "(forge-sim|misc-runner)"
```

---

## Troubleshooting

### "Running in LOCAL mode" when expecting GCP
- Check that `GOOGLE_CLOUD_PROJECT` is set in `orchestrator-service/.env`
- Ensure the .env file is being loaded (Next.js loads it automatically)

### Worker can't connect to API
- Verify `API_URL` in `simulation-worker/.env`
- For local testing, use `http://localhost:3000`
- For Cloud Run, use the deployed URL

### Pub/Sub messages not received
- Check `PUBSUB_SUBSCRIPTION` matches the subscription name in GCP
- Verify service account has `pubsub.subscriber` permission

### Firestore permission errors
- Ensure service account key path is correct
- Verify service account has Firestore read/write permissions

### Jobs stuck in QUEUED
- Ensure simulation-worker is running and connected to Pub/Sub
- Check worker logs for errors
- Verify `WORKER_SECRET` matches between orchestrator and simulation-worker
