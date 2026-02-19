# Mode Setup Guide

This project supports two operational modes: **LOCAL** and **GCP**. This guide explains each mode and how to run the system.

## Mode Overview

| Feature | LOCAL Mode | GCP Mode |
|---------|------------|----------|
| Database | SQLite | Firestore |
| File Storage | Local filesystem | Cloud Storage (GCS) |
| Job Queue | Polling-based worker | Pub/Sub |
| Analysis | Win rate / game stats | Win rate / game stats |
| Worker | worker/ (polling) | worker/ (Pub/Sub subscriber) |

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
3. Docker installed (for worker)

### Configuration Files

#### api/.env
```bash
GOOGLE_CLOUD_PROJECT="magic-bracket-simulator"
GCS_BUCKET="magic-bracket-simulator-artifacts"
PUBSUB_TOPIC="job-created"
GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account-key.json"
WORKER_SECRET="shared-secret-for-worker-auth"
NODE_ENV="development"
FORGE_ENGINE_PATH="../worker/forge-engine"
```

#### worker/.env
```bash
GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account-key.json"
GOOGLE_CLOUD_PROJECT="magic-bracket-simulator"
PUBSUB_SUBSCRIPTION="job-created-worker"
GCS_BUCKET="magic-bracket-simulator-artifacts"
API_URL="http://localhost:3000"  # or Cloud Run URL
WORKER_SECRET="shared-secret-for-worker-auth"
WORKER_API_PORT=9090
WORKER_API_URL="http://<vm-internal-ip>:9090"  # VPC-internal IP for API→worker push
```

### Running GCP Mode

**Terminal 1: API + Frontend**
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
| api | API backend (Firestore/Pub/Sub) | Local or Cloud Run |
| frontend | React UI | Local or Firebase Hosting |
| worker | Node.js orchestrator that spawns simulation containers (Docker) | Docker on your machine |
| simulation | Java + Forge engine container (ephemeral) | Spawns via `docker run` inside worker |

### Deployed API (Firebase App Hosting / Cloud Run)

When the API is deployed via Firebase App Hosting, it runs on Cloud Run. The **Cloud Run service account** (the identity that executes the API) must have **Cloud Datastore User** (`roles/datastore.user`) on the project so it can read/write Firestore (decks, jobs). If this role is missing, creating or listing jobs will fail with `7 PERMISSION_DENIED: User not authorized to perform this action`. See **Troubleshooting → Firestore permission errors** below for how to grant it.

---

## LOCAL Mode Setup

### Prerequisites
1. Node.js 18+
2. No GCP configuration needed

### Configuration
Simply ensure `GOOGLE_CLOUD_PROJECT` is **not set** in `api/.env`, or delete the `.env` file.

### Running LOCAL Mode
```bash
npm run dev:local
# or just
npm run dev
```

### Services in LOCAL Mode

| Service | Purpose |
|---------|---------|
| api | API backend with SQLite |
| frontend | React UI |
| worker (polling) | Node.js orchestrator, polls API for jobs (with push-based job notification for instant wake), spawns simulation containers |

---

## Seeding Precons

Before using GCP mode, seed the precon decks to Firestore:

```bash
cd api
export $(grep -v '^#' .env | xargs)
npx tsx scripts/seed-decks.ts
```

This loads all precon deck files from `worker/forge-engine/precons/` into Firestore.

---

## Docker Image

Build the unified worker container:

```bash
docker compose -f worker/docker-compose.yml build
```

The worker image contains the Node.js orchestrator. The simulation image (`magic-bracket-simulation`) is either pulled from GHCR or built locally and must be available to the Docker daemon so the worker can spawn it using `docker run`.

---

## Troubleshooting

### "Running in LOCAL mode" when expecting GCP
- Check that `GOOGLE_CLOUD_PROJECT` is set in `api/.env`
- Ensure the .env file is being loaded (Next.js loads it automatically)

### Worker can't connect to API
- Verify `API_URL` in `worker/.env`
- For local testing, use `http://localhost:3000`
- For Cloud Run, use the deployed URL

### Pub/Sub messages not received
- Check `PUBSUB_SUBSCRIPTION` matches the subscription name in GCP
- Verify service account has `pubsub.subscriber` permission

### Firestore permission errors (e.g. `7 PERMISSION_DENIED: User not authorized to perform this action`)
- **Deployed API (Firebase App Hosting / Cloud Run):** The backend runs as a Cloud Run service account. That identity must have **Cloud Datastore User** so it can read/write Firestore (decks, jobs). Grant the role on the project:
  - GCP Console → **IAM & Admin** → **IAM** → find the service account used by your App Hosting backend (e.g. `PROJECT_NUMBER-compute@developer.gserviceaccount.com` or the one shown in **Firebase** → **App Hosting** → your backend → **Settings**).
  - Click **Edit** (pencil) for that member → **Add another role** → **Cloud Datastore User** → Save.
  - Or via gcloud (replace `PROJECT_ID` and `SERVICE_ACCOUNT_EMAIL`):
    ```bash
    gcloud projects add-iam-policy-binding PROJECT_ID \
      --member="serviceAccount:SERVICE_ACCOUNT_EMAIL" \
      --role="roles/datastore.user"
    ```
- **Local API:** Ensure service account key path is correct and the key’s account has Firestore read/write (e.g. Cloud Datastore User).

### Jobs stuck in QUEUED
- Ensure worker is running and connected to Pub/Sub
- Check worker logs for errors
- Verify `WORKER_SECRET` matches between API and worker
