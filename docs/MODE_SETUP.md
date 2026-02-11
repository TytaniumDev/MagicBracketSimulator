# Mode Setup Guide

This project supports two operational modes: **LOCAL** and **GCP**. This guide explains each mode and how to run the system.

## Mode Overview

| Feature | LOCAL Mode | GCP Mode |
|---------|------------|----------|
| Database | SQLite | Firestore |
| File Storage | Local filesystem | Cloud Storage (GCS) |
| Job Queue | Polling-based worker | Pub/Sub |
| Analysis | analysis-service + forge-log-analyzer | Gemini API + orchestrator |
| Worker | orchestrator-service/worker (Docker Orchestration) | Unified Worker (Internal Execution) |

## Mode Detection

The system automatically detects the mode based on the `GOOGLE_CLOUD_PROJECT` environment variable:
- **Set**: GCP mode (Firestore, Pub/Sub, GCS)
- **Not set**: LOCAL mode (SQLite, filesystem)

At startup, the Orchestrator will log:
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
4. Docker (for running the Unified Worker locally)

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

#### unified-worker/.env (Optional, or use docker-compose environment)
```bash
GOOGLE_APPLICATION_CREDENTIALS="/secrets/sa.json"
GOOGLE_CLOUD_PROJECT="magic-bracket-simulator"
PUBSUB_SUBSCRIPTION="job-created-worker"
GCS_BUCKET="magic-bracket-simulator-artifacts"
API_URL="http://host.docker.internal:3000" # Use host.docker.internal to reach Orchestrator on host
WORKER_SECRET="shared-secret-for-worker-auth"
```

### Running GCP Mode

**Terminal 1: Orchestrator + Frontend**
```bash
npm run dev:gcp
```

**Terminal 2: Unified Worker**
Since the Unified Worker requires a specific Forge environment, it is easiest to run it via Docker Compose:

```bash
docker compose -f unified-worker/docker-compose.yml up --build
```
*Note: Ensure your service account key is accessible to the container (edit `docker-compose.yml` volumes if necessary).*

**Alternative: Running Worker on Host (Advanced)**
If you have Forge installed locally and want to debug the worker code directly:
1.  Set `FORGE_PATH=/path/to/forge` in `local-worker/.env`.
2.  Run `npm run worker:gcp`.

### Services in GCP Mode

| Service | Purpose | Where it runs |
|---------|---------|---------------|
| orchestrator-service | API backend, Firestore/Pub/Sub integration | Local or Cloud Run |
| frontend | React UI | Local or Firebase Hosting |
| unified-worker | Receives Pub/Sub messages, runs simulations internally | Docker (via `unified-worker`) |

---

## LOCAL Mode Setup

### Prerequisites
1. Node.js 18+
2. **Docker**: Required for `forge-sim` image.
3. No GCP configuration needed.

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
| analysis-service | OpenAI/Gemini analysis |
| forge-log-analyzer | Log processing |
| worker (polling) | Polls orchestrator, spawns Docker containers |
| forge-sim | Docker container for simulations |

---

## Docker Images (Local Mode)

Build the `forge-sim` image required for Local Mode:

```bash
cd forge-simulation-engine
docker build -t forge-sim:latest .
```

Verify images exist:
```bash
docker images | grep forge-sim
```

---

## Troubleshooting

### "Running in LOCAL mode" when expecting GCP
- Check that `GOOGLE_CLOUD_PROJECT` is set in `orchestrator-service/.env`
- Ensure the .env file is being loaded (Next.js loads it automatically)

### Worker can't connect to API
- Verify `API_URL` in `unified-worker/docker-compose.yml` or `.env`
- If running in Docker, use `http://host.docker.internal:3000` to reach the host Orchestrator.
- For Cloud Run, use the deployed URL.

### Pub/Sub messages not received
- Check `PUBSUB_SUBSCRIPTION` matches the subscription name in GCP
- Verify service account has `pubsub.subscriber` permission

### Firestore permission errors
- Ensure service account key path is correct
- Verify service account has Firestore read/write permissions
