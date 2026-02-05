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
3. **GCP credentials**: Application Default Credentials (`gcloud auth application-default login`) or a **service account key** with Pub/Sub, GCS, Firestore, and **Secret Manager Secret Accessor**

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

### 2. Configure local-worker (Secret Manager or .env)

**Option A – Secret Manager (recommended; no .env on your machine)**

1. **One-time:** From repo root, run the interactive script. It prompts for each value and prints **clickable links** to GCP Console, then stores config in Secret Manager. No .env needed if gcloud default project is set:
   ```bash
   gcloud config set project magic-bracket-simulator
   npm run populate-worker-secret
   ```
2. **On each machine:** Set only the gcloud default project (`gcloud config set project ...`) and use Application Default Credentials (`gcloud auth application-default login`) or a service account key. The worker loads the rest from Secret Manager at startup. **No .env needed** (worker and scripts also read project from `gcloud config get-value project`).

**Option B – .env (legacy)**

```bash
cd local-worker
cp .env.example .env
```

Edit `.env` with all values (see `.env.example`). The worker uses these when Secret Manager is not configured or not available.

See [docs/SECRETS_SETUP.md](../docs/SECRETS_SETUP.md) for details and IAM (Secret Manager Secret Accessor).

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

- **"No credentials"** – Run `gcloud auth application-default login` or set `GOOGLE_APPLICATION_CREDENTIALS` to a valid JSON key file
- **"Secret Manager not used"** – Normal if the secret doesn’t exist or the identity has no access; worker falls back to env/.env
- **"Permission denied"** – Service account needs `roles/pubsub.subscriber`, `roles/storage.objectAdmin`, `roles/datastore.user`, and **Secret Manager Secret Accessor** (for Secret Manager config)
- **Docker volume mount errors** – On WSL/Windows, ensure paths are correct and Docker has access to the jobs directory
