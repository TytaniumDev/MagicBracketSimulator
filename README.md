<div align="center">

# Magic Bracket Simulator

[ 🚀 Launch App ](https://magic-bracket-simulator.web.app)  [ 📖 Documentation ](#documentation-map)  [ 🐞 Report Bug ](https://github.com/TytaniumDev/MagicBracketSimulator/issues)

**Simulate thousands of Magic: The Gathering Commander games to predict tournament brackets. Powered by Forge and Docker.**

<br>

![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat-square&logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?style=flat-square&logo=react&logoColor=61DAFB)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat-square&logo=docker&logoColor=white)
![Firebase](https://img.shields.io/badge/Firebase-FFCA28?style=flat-square&logo=firebase&logoColor=black)

<br>

</div>

![Magic Bracket Simulator UI](docs/images/hero-screenshot.png)

## Quick Start

Run the full stack locally.
See [Deployment Guide](docs/DEPLOYMENT.md) for detailed setup.

1. **Install dependencies:**
   ```bash
   npm run install:all
   ```

2. **Start the App (Frontend & API):**
   ```bash
   npm run dev
   ```

3. **Start the Worker (in a new terminal):**
   *Note: Requires Docker to be running.*
   ```bash
   cd worker && npm run dev
   ```

Visit **http://localhost:5173** to start simulating.

## Key Features

*   **⚡ Parallel Simulation:** Runs multiple Forge instances concurrently via Docker.
*   **📊 Win Rate Analysis:** Tracks per-deck win rates and game statistics across simulations.
*   **☁️ Hybrid Architecture:** Runs fully locally or on Google Cloud Platform.

## Documentation Map

*   **[Architecture Overview](docs/ARCHITECTURE.md):** Deep dive into the system design, Docker worker, and data flow.
*   **[Architecture Issues](docs/ARCHITECTURE_ISSUES.md):** Identified architecture issues and future improvements.
*   **[API Reference](API.md):** Authoritative reference for all system API endpoints (System, Jobs, Worker).
*   **[API Backend Setup](api/README.md):** Details on setting up and running the Next.js API server.
*   **[API Product Requirement Document](api/PRD.md):** Features and workflows for the API Service.
*   **[Data Flow](DATA_FLOW.md):** Detailed explanation of data transitions through the application.
*   **[Deployment Guide](docs/DEPLOYMENT.md):** Detailed setup instructions, prerequisites, and cloud deployment.
*   **[Frontend Setup](frontend/README.md):** Details on the React SPA frontend application.
*   **[Implementation Plan](docs/IMPLEMENTATION_PLAN_WORKER_SPLIT.md):** Plan for the Worker + Simulation Split Architecture.
*   **[Mode Setup](docs/MODE_SETUP.md):** Configure for Local vs GCP operation.
*   **[Precon Sync](docs/PRECON_SYNC.md):** Daily synchronization of Firestore decks with Archidekt.
*   **[Remote Worker Setup](docs/DEPLOYMENT.md#remote-worker-headless-machine):** Deploy the worker on a separate machine with auto-updates via Watchtower.
*   **[Secrets Setup](docs/SECRETS_SETUP.md):** How to configure API keys and credentials.
*   **[Stale Job Sweeper](docs/STALE_SWEEPER.md):** Recovery net for stuck jobs (`POST /api/admin/sweep-stale-jobs`).
*   **[Sweeper Alerting](docs/SWEEPER_ALERTING.md):** Cloud Monitoring setup for the stale-job sweeper.
*   **[Worker Setup](worker/README.md):** Details on the Node.js simulation orchestrator.

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) to get started.
