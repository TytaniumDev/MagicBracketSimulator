# Deployment and Setup Guide

## Prerequisites

*   **Node.js:** 18+
*   **Docker:** Required for the worker container.

See [api/README.md](../api/README.md) for detailed API setup (e.g., `.env` files).

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

### One-Line Setup (Recommended)

Any allowed user can set up a worker without GCP access, git, or dev tools. The setup script auto-installs Docker and all dependencies.

**1. Generate a setup token** — visit `/worker-setup` in the frontend (requires sign-in as an allowed user). This generates a time-limited token (valid 24 hours).

**2. Run the one-liner** on the worker machine (macOS, Linux, or WSL):

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/TytaniumDev/MagicBracketSimulator/main/scripts/setup-worker.sh) --api=<API_URL>
```

**3. Paste the setup token** when prompted. The script will:
- Install Docker, jq, curl, and openssl if missing
- Download compose files from GitHub
- Fetch encrypted config from the API using the setup token
- Decrypt and write `sa.json` and `.env` locally
- Pull Docker images and start the worker + Watchtower

The setup token uses HMAC-based authentication — the worker secret never leaves the API server. Config is AES-256-GCM encrypted in transit (double-encrypted with HTTPS).

**To update secrets later:**
1. Update the secret in GitHub repo settings
2. Re-run the Provision Worker workflow
3. On each worker machine: re-run the setup command with a new token

### Legacy Setup (gcloud)

If you have GCP access, you can still use the legacy flow that reads directly from Secret Manager:

```bash
git clone https://github.com/TytaniumDev/MagicBracketSimulator.git
cd MagicBracketSimulator
./scripts/setup-worker.sh
```

When prompted, type `gcloud` to use the legacy flow. The script will install `jq` and `gcloud` if needed, run GCP auth, and read config from Secret Manager.

**First-time GCP setup:** Populate Secret Manager by running the Provision Worker workflow:
1. Add secrets to your GitHub repo (**Settings > Secrets > Actions**). See [SECRETS_SETUP.md](SECRETS_SETUP.md).
2. Run `gh workflow run provision-worker.yml`.

### What the Worker Does

- Loads runtime config from Secret Manager (API_URL, GCS_BUCKET, PUBSUB_SUBSCRIPTION, WORKER_SECRET)
- Subscribes to Pub/Sub for job messages
- Runs Forge simulations and POSTs results back to the API
- Receives push commands from the API (config overrides, cancellation, job notifications, drain control) via port 9090

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

- **SSH/Tailscale access:** The worker accepts inbound push commands from the API on
  port 9090 (config updates, cancellation, job notifications). In local mode this is
  localhost-only; in GCP mode it uses VPC-internal networking. The worker also makes
  outbound connections to Pub/Sub, API, and Secret Manager.

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

## Worker Configuration

The worker can be configured via environment variables (in `.env` or Secret Manager).

| Variable | Description | Default / Example |
|----------|-------------|-------------------|
| `GOOGLE_CLOUD_PROJECT` | GCP Project ID (triggers GCP mode if set) | `magic-bracket-simulator` |
| `API_URL` | Base URL of the API | `http://localhost:3000` or Cloud Run URL |
| `WORKER_SECRET` | Shared secret for worker authentication | `some-secret-string` |
| `PUBSUB_SUBSCRIPTION` | Pub/Sub subscription name (GCP mode only) | `job-created-worker` |
| `SIMULATION_IMAGE` | Docker image for the simulation container | `ghcr.io/tytaniumdev/magicbracketsimulator/simulation:latest` |
| `WORKER_NAME` | Display name for the worker (visible in UI) | Hostname |
| `WORKER_ID` | Unique ID for the worker (auto-generated if unset) | `worker-uuid-1234` |
| `WORKER_OWNER_EMAIL` | Contact email for the worker operator | `admin@example.com` |
| `POLL_INTERVAL_MS` | Polling interval in ms (Local mode only) | `3000` |
| `JOBS_DIR` | Local directory for temporary job files | `/tmp/mbs-jobs` |
| `WORKER_API_PORT` | Port for the worker's push-based HTTP API | `9090` |
| `WORKER_API_URL` | Externally reachable URL for the worker API (reported via heartbeat) | `http://<vm-internal-ip>:9090` |
| `AUTH_TOKEN` | Bearer token if API requires standard auth (rare) | - |
