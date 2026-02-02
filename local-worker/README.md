# Local Worker - Pub/Sub + Docker Setup

The local worker pulls jobs from **GCP Pub/Sub** (not Firebase) and runs **forge-sim** and **misc-runner** Docker containers. The Docker containers do **not** connect to Pub/Sub directly—the worker orchestrates everything.

## Architecture

```
Pub/Sub (job-created-worker) 
    ↓ pull messages
Local Worker (Node.js)
    ↓ spawns
forge-sim Docker  →  misc-runner Docker
```

## Prerequisites

1. **Docker** installed and running
2. **forge-sim** and **misc-runner** images built
3. **Service account key** with Pub/Sub + GCS + Firestore access

## Setup Steps

### 1. Build Docker images

```bash
# Build forge-sim (from forge-simulation-engine)
cd forge-simulation-engine
docker build -t forge-sim:latest .

# Build misc-runner
cd ../misc-runner
docker build -t misc-runner:latest .
```

### 2. Create local-worker .env

```bash
cd local-worker
cp .env.example .env
```

Edit `.env` with:

```bash
# Required: Path to service account key (from Phase 0.6 of the plan)
GOOGLE_APPLICATION_CREDENTIALS="/home/wsl/magic-bracket-simulator-worker-key.json"
GOOGLE_CLOUD_PROJECT="magic-bracket-simulator"

# Pub/Sub subscription
PUBSUB_SUBSCRIPTION="job-created-worker"

# GCS bucket
GCS_BUCKET="magic-bracket-simulator-artifacts"

# Cloud Run API URL (orchestrator)
API_URL="https://orchestrator-jfmj7qwxca-uc.a.run.app"

# Docker image names (must match your built images)
FORGE_SIM_IMAGE="forge-sim:latest"
MISC_RUNNER_IMAGE="misc-runner:latest"

# Local jobs directory (where deck files and logs are written)
JOBS_DIR="./jobs"
```

### 3. Install and run the worker

```bash
cd local-worker
npm install
npm run dev
```

The worker will:
- Connect to Pub/Sub and wait for messages
- When a job is created (via the frontend/API), it receives the message
- Fetches job details from the orchestrator API
- Writes deck files to `./jobs/{jobId}/decks/`
- Runs forge-sim container(s)
- Runs misc-runner container to condense logs and upload to GCS
- Acknowledges the message

### 4. API auth (optional)

If the orchestrator API requires Firebase Auth, the worker needs a token. For development, you can use a service account or bypass auth on certain endpoints. The worker currently sends requests without auth; add `AUTH_TOKEN` to `.env` if your API expects it.

## Troubleshooting

- **"No credentials"** – Ensure `GOOGLE_APPLICATION_CREDENTIALS` points to a valid JSON key file
- **"Permission denied"** – Service account needs `roles/pubsub.subscriber`, `roles/storage.objectAdmin`, `roles/datastore.user`
- **Docker volume mount errors** – On WSL/Windows, ensure paths are correct and Docker has access to the jobs directory
