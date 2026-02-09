# Mode Setup Guide

This project supports two operational modes: **LOCAL** and **GCP**. This guide explains each mode and how to run the system.

## Mode Overview

| Feature | LOCAL Mode | GCP Mode |
|---------|------------|----------|
| Database | SQLite | Firestore |
| File Storage | Local filesystem | Cloud Storage (GCS) |
| Job Queue | Polling-based worker | Pub/Sub |
| Analysis | analysis-service + forge-log-analyzer | Gemini API (internal) |
| Worker | orchestrator-service/worker (Docker spawn) | Unified Worker (Process spawn) |

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
4. Docker installed (for running the Unified Worker)

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
```

#### local-worker/.env
(Required only if running via `npm run worker:gcp` locally, not needed for Docker)
```bash
GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account-key.json"
GOOGLE_CLOUD_PROJECT="magic-bracket-simulator"
PUBSUB_SUBSCRIPTION="job-created-worker"
GCS_BUCKET="magic-bracket-simulator-artifacts"
API_URL="http://localhost:3000"  # or Cloud Run URL
JOBS_DIR="./jobs"
WORKER_SECRET="shared-secret-for-worker-auth"
```

### Running GCP Mode

#### 1. Start Orchestrator + Frontend
```bash
npm run dev:gcp
```

#### 2. Start Unified Worker (Docker - Recommended)
The Unified Worker runs as a single container including Node.js, Java, and Forge.

First, build the image from the root directory:
```bash
docker build -t unified-worker:latest -f unified-worker/Dockerfile .
```

Then run it:
```bash
docker run -it --rm \
  -e GOOGLE_CLOUD_PROJECT="magic-bracket-simulator" \
  -e PUBSUB_SUBSCRIPTION="job-created-worker" \
  -e GCS_BUCKET="magic-bracket-simulator-artifacts" \
  -e API_URL="http://host.docker.internal:3000" \
  -e WORKER_SECRET="shared-secret-for-worker-auth" \
  -e GOOGLE_APPLICATION_CREDENTIALS="/app/key.json" \
  -v "/path/to/service-account-key.json:/app/key.json:ro" \
  unified-worker:latest
```

*Note: On Linux, use `--network host` instead of `host.docker.internal` for localhost access.*

#### Alternative: Running Worker Directly (Advanced)
If you have Java 17+, Forge, and Xvfb installed on your host machine, you can run the worker directly:
```bash
# Set FORGE_PATH env var if Forge is not in /app/forge
npm run worker:gcp
```

### Services in GCP Mode

| Service | Purpose | Where it runs |
|---------|---------|---------------|
| orchestrator-service | API backend, Firestore/Pub/Sub integration | Local or Cloud Run |
| frontend | React UI | Local or Firebase Hosting |
| unified-worker | Receives Pub/Sub messages, runs Forge internally | Docker container |

---

## LOCAL Mode Setup

### Prerequisites
1. Node.js 18+
2. Docker (for `forge-sim` containers)
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

---

## Seeding Precons (GCP Only)

Before using GCP mode, seed the precon decks to Firestore:

```bash
cd orchestrator-service
export $(grep -v '^#' .env | xargs)
npx tsx scripts/seed-decks.ts
```

This loads all precon deck files from `forge-simulation-engine/precons/` into Firestore.

---

## Docker Images (Local Mode Only)

For **Local Mode**, you need the `forge-sim` image:

```bash
cd forge-simulation-engine
docker build -t forge-sim:latest .
```

(The Unified Worker for GCP mode handles its own dependencies.)

---

## Troubleshooting

### "Running in LOCAL mode" when expecting GCP
- Check that `GOOGLE_CLOUD_PROJECT` is set in `orchestrator-service/.env`
- Ensure the .env file is being loaded (Next.js loads it automatically)

### Worker can't connect to API
- Verify `API_URL` environment variable.
- Use `http://host.docker.internal:3000` if running worker in Docker and Orchestrator on host.
- Use the deployed Cloud Run URL if Orchestrator is in cloud.

### Pub/Sub messages not received
- Check `PUBSUB_SUBSCRIPTION` matches the subscription name in GCP
- Verify service account has `pubsub.subscriber` permission

### Firestore permission errors
- Ensure service account key path is correct
- Verify service account has Firestore read/write permissions
