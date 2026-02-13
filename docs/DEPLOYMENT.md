# Deployment and Setup Guide

## Prerequisites

*   **Node.js:** 18+
*   **Docker:** Required for the worker container.

See [api/README.md](../api/README.md) for detailed API setup (e.g., `.env` files, `GEMINI_API_KEY`).

### Windows Setup (WSL)

If opening the project from Windows (e.g., Cursor with a `\\wsl.localhost\...` path):
*   `npm run dev` will re-run inside WSL.
*   You need Node and npm installed **inside WSL** (not just Windows).
    ```bash
    sudo apt update && sudo apt install -y nodejs npm
    ```

## Deployment and Secrets

*   **GCP vs Local Mode:** See [MODE_SETUP.md](MODE_SETUP.md) for details.
*   **Secrets:** See [SECRETS_SETUP.md](SECRETS_SETUP.md) for step-by-step instructions.
    *   Frontend API URL is committed in `frontend/public/config.json`.
    *   Use Secret Manager for worker config.

### Finding your API URL

Run `npm run get-cloud-run-url` (requires gcloud), or check the [Firebase Console](https://console.firebase.google.com/) or [GCP Console](https://console.cloud.google.com/run).

### Firebase Hosting (Frontend)

To deploy the frontend to Firebase Hosting:

```bash
firebase deploy --only hosting
```

**CI/CD:**
Merges to `main` trigger a GitHub Actions workflow that runs tests and deploys to Firebase Hosting. Ensure **FIREBASE_TOKEN** is configured in GitHub Secrets.

---

## Remote Worker (Headless Machine)

You can run the worker on any machine with Docker — e.g., a headless Mac Mini, a spare Linux box, or a cloud VM. The worker connects to the GCP-hosted API over the network; no local API or frontend required.

### Prerequisites

- Docker installed and running
- `gcloud` CLI installed (for authentication and Secret Manager access)
- Network access to your API URL (direct internet, Tailscale, VPN, etc.)

### One-Time Setup

1. **Authenticate with GCP:**
   ```bash
   gcloud auth login
   gcloud config set project YOUR_PROJECT_ID
   gcloud auth application-default login
   ```

2. **Clone the repo:**
   ```bash
   git clone https://github.com/TytaniumDev/MagicBracketSimulator.git
   cd MagicBracketSimulator
   ```

3. **Populate Secret Manager** (if not already done from another machine):
   ```bash
   npm install         # installs root deps (Secret Manager client)
   npm run populate-worker-secret
   ```
   Or with defaults:
   ```bash
   npm run populate-worker-secret -- --defaults --worker-secret=YOUR_SECRET
   ```

4. **Build the worker container:**
   ```bash
   docker compose -f worker/docker-compose.yml build
   ```

### Running

```bash
# GCP mode (Pub/Sub, production API)
docker compose -f worker/docker-compose.yml up -d
```

The worker will:
- Load config from Secret Manager (API_URL, GCS_BUCKET, PUBSUB_SUBSCRIPTION, WORKER_SECRET)
- Subscribe to Pub/Sub for job messages
- Run Forge simulations and POST results back to the API

### Credentials

The docker-compose.yml mounts your GCP credentials into the container. By default
it maps `~/.config/gcloud/application_default_credentials.json`. If using a
service account key file, set `GOOGLE_APPLICATION_CREDENTIALS` in a `.env` file
next to docker-compose.yml:

```bash
# worker/.env (only if using a key file instead of ADC)
GOOGLE_APPLICATION_CREDENTIALS=/path/to/your-key.json
```

### macOS Tips (Headless Mac Mini)

- **Prevent sleep during simulations:** Consider running:
  ```bash
  caffeinate -i docker compose -f worker/docker-compose.yml up
  ```
  Or set Energy Saver to "Prevent automatic sleeping" in System Settings.

- **Docker Desktop resource limits:** Increase memory allocation in Docker Desktop
  settings. The worker auto-scales parallelism based on available RAM (~600MB per
  Forge instance). With 16GB RAM, expect 4-6 parallel simulations.

- **SSH/Tailscale access:** No special configuration needed. The worker only makes
  outbound connections (to GCP Pub/Sub, API, and Secret Manager). No inbound ports
  required.

### Auto-Deploy with Watchtower

The `deploy-worker.yml` GitHub Actions workflow builds a multi-arch Docker image
(amd64 + arm64) and pushes it to GHCR on every merge to `main`.

[Watchtower](https://containrrr.dev/watchtower/) runs alongside the worker on your
remote machine, polls GHCR for new images every 5 minutes, and automatically pulls
and restarts the worker container. No SSH or CI access to the machine required.

**Setup on the worker machine:**

1. Create a GitHub PAT with `read:packages` scope
2. Set credentials in `worker/.env`:
   ```bash
   # worker/.env
   IMAGE_NAME=ghcr.io/tytaniumdev/magicbracketsimulator/worker
   GHCR_USER=your-github-username
   GHCR_TOKEN=ghp_your_token_here
   ```
3. Start worker + Watchtower:
   ```bash
   docker login ghcr.io -u YOUR_GITHUB_USER -p YOUR_GHCR_TOKEN
   docker compose -f worker/docker-compose.yml -f worker/docker-compose.watchtower.yml up -d
   ```

Watchtower will now auto-update the worker whenever a new image is pushed to GHCR.

**Worker machine bootstrap:**

```bash
# 1. Install Docker
# macOS: Install Docker Desktop from https://docker.com
# Linux: curl -fsSL https://get.docker.com | sh

# 2. Install gcloud CLI
# https://cloud.google.com/sdk/docs/install

# 3. Clone repo
git clone https://github.com/TytaniumDev/MagicBracketSimulator.git ~/MagicBracketSimulator
cd ~/MagicBracketSimulator

# 4. GCP auth (one-time)
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
gcloud auth application-default login

# 5. Populate Secret Manager (one-time, if not done from another machine)
npm install
npm run populate-worker-secret

# 6. Start worker + Watchtower
docker login ghcr.io -u YOUR_GITHUB_USER -p YOUR_GHCR_TOKEN
docker compose -f worker/docker-compose.yml -f worker/docker-compose.watchtower.yml up -d
```

### Monitoring

```bash
# Worker logs
docker compose -f worker/docker-compose.yml logs -f worker

# Watchtower logs (see when updates happen)
docker compose -f worker/docker-compose.yml -f worker/docker-compose.watchtower.yml logs -f watchtower
```
