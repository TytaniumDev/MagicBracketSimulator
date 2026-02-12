# Deployment and Setup Guide

## Prerequisites

*   **Node.js:** 18+
*   **Docker:** Required for running the Unified Worker (simulations).
*   **Google Cloud SDK:** (Optional) For deploying to GCP.

## Local Development Setup

### 1. Install Dependencies
Run the following command from the root directory to install dependencies for all services (API, Frontend, Worker):

```bash
npm run install:all
```

### 2. Start the API and Frontend
This command starts the Next.js API (port 3000) and the React Frontend (port 5173).

```bash
npm run dev
```
Visit **http://localhost:5173** to view the app.

### 3. Start the Simulation Worker
The worker processes jobs from the API. You can run it in two ways:

#### Option A: Docker (Recommended)
Running the worker in Docker ensures all dependencies (Java, Forge, xvfb) are present without manual installation.

```bash
# From the root directory
docker compose -f worker/docker-compose.yml -f worker/docker-compose.local.yml up --build
```

#### Option B: Manual (Advanced)
If you prefer to run the worker on your host machine, you must have **Java 17+** and **Forge** installed.

1.  Install Java 17 JRE.
2.  Download Forge and extract it.
3.  Set the `FORGE_PATH` environment variable to your Forge directory (the one containing `forge.sh`).
    ```bash
    export FORGE_PATH=/path/to/forge
    ```
4.  Run the worker:
    ```bash
    cd worker
    npm run dev
    ```

## GCP Deployment

### 1. Build and Push the Worker Image
The Unified Worker runs as a single container in Cloud Run (or Compute Engine) that handles both the Node.js worker logic and the internal Java Forge processes.

```bash
# Build for linux/amd64 (required for Cloud Run)
docker build --platform linux/amd64 -t gcr.io/YOUR_PROJECT/unified-worker:latest ./worker
docker push gcr.io/YOUR_PROJECT/unified-worker:latest
```

### 2. Deploy the API (Cloud Run)
The API and Frontend are deployed as a single Next.js service.

```bash
# Example using gcloud
gcloud run deploy magic-bracket-api \
  --source . \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated
```

### 3. Deploy the Worker
Deploy the worker image. Ensure it has the correct environment variables (API URL, Pub/Sub subscription).

```bash
gcloud run deploy magic-bracket-worker \
  --image gcr.io/YOUR_PROJECT/unified-worker:latest \
  --platform managed \
  --region us-central1 \
  --no-allow-unauthenticated \
  --set-env-vars API_URL=https://your-api-url.a.run.app,PUBSUB_SUBSCRIPTION=job-created-worker
```

## Secrets

See [docs/SECRETS_SETUP.md](SECRETS_SETUP.md) for configuring:
*   `GEMINI_API_KEY` (for Analysis)
*   Firebase Admin SDK
*   Worker Secrets

## Troubleshooting

*   **Worker not picking up jobs:** Ensure the API URL in the worker matches your running API (e.g., `http://host.docker.internal:3000` for Docker on Mac/Windows).
*   **Forge errors:** Check the worker logs. If running locally without Docker, ensure Java 17 is in your PATH.
