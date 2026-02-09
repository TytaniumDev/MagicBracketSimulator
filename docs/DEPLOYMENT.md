# Deployment and Setup Guide

## Prerequisites

*   **Node.js:** 18+
*   **Docker:** Required for Local Mode (`forge-sim`) or GCP Mode (`unified-worker`).
*   **Python:** 3.11+ with [uv](https://github.com/astral-sh/uv) (Local Mode only, for legacy analysis service).

See [orchestrator-service/README.md](../orchestrator-service/README.md) for detailed setup (e.g., `.env` files, `GEMINI_API_KEY`).

### Windows Setup (WSL)

If opening the project from Windows (e.g., Cursor with a `\\wsl.localhost\...` path):
*   `npm run dev` will re-run inside WSL.
*   You need Node and npm installed **inside WSL** (not just Windows).
    ```bash
    sudo apt update && sudo apt install -y nodejs npm
    ```

## Deployment and Secrets

*   **GCP vs Local Mode:** See [MODE_SETUP.md](MODE_SETUP.md) for details on switching modes.
*   **Secrets:** See [SECRETS_SETUP.md](SECRETS_SETUP.md) for step-by-step instructions.
    *   Frontend API URL is committed in `frontend/public/config.json`.
    *   Use Secret Manager for worker config.

### 1. Frontend (Firebase Hosting)

To deploy the frontend to Firebase Hosting:

```bash
firebase deploy --only hosting
```

**CI/CD:**
Merges to `main` trigger a GitHub Actions workflow that runs tests and deploys to Firebase Hosting. Ensure **FIREBASE_TOKEN** is configured in GitHub Secrets.

### 2. API (Cloud Run)

The Orchestrator Service is deployed to Cloud Run.

```bash
cd orchestrator-service
gcloud run deploy orchestrator \
  --source . \
  --region us-central1 \
  --allow-unauthenticated
```

### 3. Worker (Unified Worker)

The Unified Worker processes simulation jobs. It can be run on any machine with Docker (e.g., a Compute Engine VM or your local machine).

**Build the Image:**
```bash
docker build -t unified-worker:latest -f unified-worker/Dockerfile .
```

**Run the Worker:**
```bash
docker run -d --restart always \
  --name magic-worker \
  -e GOOGLE_CLOUD_PROJECT="magic-bracket-simulator" \
  -e PUBSUB_SUBSCRIPTION="job-created-worker" \
  -e GCS_BUCKET="magic-bracket-simulator-artifacts" \
  -e API_URL="https://your-cloud-run-url.run.app" \
  -e WORKER_SECRET="your-worker-secret" \
  -e GOOGLE_APPLICATION_CREDENTIALS="/app/key.json" \
  -v "/path/to/service-account-key.json:/app/key.json:ro" \
  unified-worker:latest
```
