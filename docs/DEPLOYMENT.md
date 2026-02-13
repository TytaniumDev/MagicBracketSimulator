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
- `jq` installed (`brew install jq` / `apt install jq`)
- Network access to your API URL (direct internet, Tailscale, VPN, etc.)

### Quick Setup (Recommended)

Secrets are managed via GitHub Actions and GCP Secret Manager. No manual `.env` creation, no interactive prompts, no PAT juggling.

**First, populate Secret Manager** (one-time, from any machine):
1. Add all required secrets to your GitHub repo (**Settings > Secrets > Actions**). See [SECRETS_SETUP.md](SECRETS_SETUP.md) for the full list.
2. Run the **Provision Worker** workflow from the GitHub Actions tab (or `gh workflow run provision-worker.yml`). This syncs your secrets into GCP Secret Manager.

**Then, on each worker machine:**

```bash
# 1. Install prerequisites (macOS example)
brew install --cask google-cloud-sdk
brew install jq

# 2. GCP auth (one-time, opens browser)
gcloud auth application-default login
gcloud config set project YOUR_PROJECT_ID

# 3. Clone and run
git clone https://github.com/TytaniumDev/MagicBracketSimulator.git
cd MagicBracketSimulator
./scripts/setup-worker.sh
```

The setup script reads all config from Secret Manager, writes `worker/sa.json` and `worker/.env`, logs into GHCR, and starts the worker + Watchtower. That's it.

**To update secrets later:**
1. Update the secret in GitHub repo settings
2. Re-run the Provision Worker workflow
3. On each worker machine: `./scripts/setup-worker.sh`

### What the Worker Does

- Loads runtime config from Secret Manager (API_URL, GCS_BUCKET, PUBSUB_SUBSCRIPTION, WORKER_SECRET)
- Subscribes to Pub/Sub for job messages
- Runs Forge simulations and POSTs results back to the API

### Credentials

The `setup-worker.sh` script places a service account key at `worker/sa.json` and configures `docker-compose.yml` to mount it into the container. If you prefer gcloud ADC instead, remove `SA_KEY_PATH` from `worker/.env` and the compose file will fall back to `~/.config/gcloud/application_default_credentials.json`.

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

[Watchtower](https://watchtower.nickfedor.com/) (image: `nickfedor/watchtower`) runs
alongside the worker on your remote machine, polls GHCR for new images every 5 minutes,
and automatically pulls and restarts the worker container. Compatible with Docker 29+.
No SSH or CI access to the machine required.

The `setup-worker.sh` script configures Watchtower automatically (GHCR credentials
are read from Secret Manager). No manual PAT setup needed.

### Manual Setup (Alternative)

If you prefer not to use the automated setup:

1. Create `worker/.env` with `SA_KEY_PATH`, `IMAGE_NAME`, `GHCR_USER`, `GHCR_TOKEN` (see `worker/.env.example`)
2. Place your GCP service account key at the path specified by `SA_KEY_PATH`
3. `docker login ghcr.io -u YOUR_GITHUB_USER -p YOUR_GHCR_TOKEN`
4. `docker compose -f worker/docker-compose.yml -f worker/docker-compose.watchtower.yml up -d`

### Monitoring

```bash
# Worker logs
docker compose -f worker/docker-compose.yml logs -f worker

# Watchtower logs (see when updates happen)
docker compose -f worker/docker-compose.yml -f worker/docker-compose.watchtower.yml logs -f watchtower
```
