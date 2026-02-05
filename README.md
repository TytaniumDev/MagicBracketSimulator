# MagicBracketSimulator

An attempt to better figure out commander brackets through simulation.

## Repo layout

- **frontend/** – The **web UI** (Vite + React). This is the only user-facing app; run it for the simulator interface at http://localhost:5173.
- **orchestrator-service/** – API and worker: deck ingestion, job store, simulation orchestration. Serves APIs consumed by the frontend.
- **forge-log-analyzer/** – TypeScript service that parses, condenses, and structures Forge game logs. Provides raw/condensed/structured log endpoints and forwards condensed logs to the Analysis Service.
- **analysis-service/** – Python service that uses Gemini AI to analyze condensed game logs and assign a power bracket (1-5).
- **forge-simulation-engine/** – Docker-based Forge simulation runner.

## Architecture

```
┌─────────────┐     ┌─────────────────┐     ┌──────────────────┐
│   Frontend  │────▶│   Orchestrator  │────▶│  Forge (Docker)  │
│  (React)    │     │  (API + Worker) │     │   Simulation     │
└─────────────┘     └────────┬────────┘     └──────────────────┘
       │                     │                        │
       │                     │ raw logs               │
       │                     ▼                        │
       │            ┌─────────────────┐               │
       └───────────▶│  Log Analyzer   │◀──────────────┘
     raw/condensed  │ (condense, store)│
     /structured    └────────┬────────┘
                             │ condensed
                             ▼
                    ┌─────────────────┐
                    │ Analysis Service│
                    │  (Gemini AI)    │
                    └─────────────────┘
```

## Running the full app

**Prerequisites:** Node.js 18+, Python 3.11+ with [uv](https://github.com/astral-sh/uv), Docker (with `forge-sim` image built). See [orchestrator-service/README.md](orchestrator-service/README.md) and [analysis-service/README.md](analysis-service/README.md) for setup (`.env` files, `GEMINI_API_KEY`, etc.).

**Opening the project from Windows (e.g. Cursor with a `\\wsl.localhost\...` path):** `npm run dev` will re-run inside WSL. You need Node and npm installed **inside WSL** (not only on Windows). In a WSL terminal run: `sudo apt update && sudo apt install -y nodejs npm`. For the analysis service you also need [uv](https://github.com/astral-sh/uv) in WSL: `curl -LsSf https://astral.sh/uv/install.sh | sh` (then restart the terminal or `source ~/.bashrc`).

### One command (from repo root)

```bash
npm run install:all
npm run dev
```

Installs root, orchestrator-service, forge-log-analyzer, and frontend dependencies, then starts:
- **Analysis Service** (port 8000)
- **Log Analyzer** (port 3001)
- **Orchestrator API** (port 3000)
- **Frontend** (port 5173)
- **Worker** (processes simulation jobs)

Open **http://localhost:5173** in your browser for the web UI. (If you only ran `npm install` at the root before, run `npm run install:all` once so the subprojects get their dependencies.)

### Windows: double-click launcher

1. Run `npm install` once from the repo root (if you haven’t already).
2. Double-click **Start-MagicBracket.bat** to start both services in one window.
3. Close the window (or press Ctrl+C) to stop.

(To use the new frontend, run `npm run frontend` from the repo root in a separate terminal and open http://localhost:5173.)

## Deployment and secrets

- **GCP vs local mode:** See [MODE_SETUP.md](MODE_SETUP.md) for LOCAL vs GCP setup and running the local worker.
- **Secrets and credentials:** See **[docs/SECRETS_SETUP.md](docs/SECRETS_SETUP.md)** for step-by-step instructions. The frontend API URL is **committed** in `frontend/public/config.json` (stable App Hosting URL; not a secret). Use Secret Manager for worker config (e.g. `npm run populate-worker-secret`). Frontend always uses the committed `config.json`.
- **Find your Cloud Run URL:** Run `npm run get-cloud-run-url` (requires gcloud), or use [Firebase Console → App Hosting](https://console.firebase.google.com/) or [GCP Console → Cloud Run](https://console.cloud.google.com/run).

### Firebase Hosting (frontend)

The frontend is deployed to **Firebase Hosting**. From the repo root:

```bash
firebase deploy --only hosting  # predeploy runs the frontend build; config.json is committed
```

**CI/CD:** Merges to `main` trigger a GitHub Actions workflow that runs the same tests as CI (frontend + orchestrator lint/build/test); if all pass, it deploys to Firebase Hosting. Configure **FIREBASE_TOKEN** in the repo’s **Settings → Secrets and variables → Actions**; see [docs/SECRETS_SETUP.md](docs/SECRETS_SETUP.md).
