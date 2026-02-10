# Deployment and Setup Guide

## Prerequisites

*   **Node.js:** 18+
*   **Python:** 3.11+ with [uv](https://github.com/astral-sh/uv) (for Local Mode analysis)
*   **Docker:**
    *   **Local Mode:** Required to run `forge-sim` containers.
    *   **GCP Mode:** Required to run the `unified-worker` container locally (or deploy to Cloud Run).

See [orchestrator-service/README.md](../orchestrator-service/README.md) and [analysis-service/README.md](../analysis-service/README.md) for service-specific details.

### Windows Setup (WSL)

If opening the project from Windows (e.g., Cursor with a `\\wsl.localhost\...` path):
*   `npm run dev` will re-run inside WSL.
*   You need Node and npm installed **inside WSL** (not just Windows).
    ```bash
    sudo apt update && sudo apt install -y nodejs npm
    ```
*   For the analysis service (Local Mode), install `uv` in WSL:
    ```bash
    curl -LsSf https://astral.sh/uv/install.sh | sh
    # Restart terminal or source ~/.bashrc
    ```

## Deployment and Secrets

*   **GCP vs Local Mode:** See [MODE_SETUP.md](MODE_SETUP.md) for detailed configuration and running instructions.
*   **Secrets:** See [SECRETS_SETUP.md](SECRETS_SETUP.md) for step-by-step instructions.
    *   Frontend API URL is committed in `frontend/public/config.json`.
    *   Use Google Secret Manager for `unified-worker` configuration in production.

### Building and Deploying Unified Worker (GCP)

To deploy the Unified Worker to Google Cloud Run (or similar):

1.  **Build the container image:**
    ```bash
    gcloud builds submit --tag gcr.io/[PROJECT_ID]/unified-worker -f unified-worker/Dockerfile .
    ```

2.  **Deploy to Cloud Run (or run on VM):**
    Ensure the service account has `pubsub.subscriber`, `storage.objectAdmin`, and `datastore.user` roles.
    Set environment variables as defined in [MODE_SETUP.md](MODE_SETUP.md).

### Finding your Cloud Run URL

Run `npm run get-cloud-run-url` (requires gcloud), or check the [Firebase Console](https://console.firebase.google.com/) or [GCP Console](https://console.cloud.google.com/run).

### Firebase Hosting (Frontend)

To deploy the frontend to Firebase Hosting:

```bash
firebase deploy --only hosting
```

**CI/CD:**
Merges to `main` trigger a GitHub Actions workflow that runs tests and deploys to Firebase Hosting. ensure **FIREBASE_TOKEN** is configured in GitHub Secrets.
