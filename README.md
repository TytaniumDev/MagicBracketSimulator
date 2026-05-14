<div align="center">

# Magic Bracket Simulator

[ 🚀 Launch App ](https://magic-bracket-simulator.web.app)  [ 📖 Documentation ](#documentation-map)  [ 🐛 Report Bug ](https://github.com/TytaniumDev/MagicBracketSimulator/issues)

**Simulate thousands of Magic: The Gathering Commander games to predict tournament brackets. Powered by Forge.**

<br>

![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat-square&logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?style=flat-square&logo=react&logoColor=61DAFB)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat-square&logo=docker&logoColor=white)
![Firebase](https://img.shields.io/badge/Firebase-FFCA28?style=flat-square&logo=firebase&logoColor=black)

<br>

</div>

![Magic Bracket Simulator UI](docs/images/hero-screenshot.png)

## Quick Start

**Just want to run simulations?** Download the desktop worker for your platform from the [latest release](https://github.com/TytaniumDev/MagicBracketSimulator/releases/latest) and double-click. macOS builds are Developer-ID signed + notarized; Windows builds will trip SmartScreen the first time — click *More info → Run anyway*. The worker self-updates from then on.

The worker has two modes:
- **Cloud:** signs in with Google, picks up jobs from the shared Firestore queue. Results show on the [web leaderboard](https://magic-bracket-simulator.web.app).
- **Offline:** picks 4 bundled Commander precons, runs the bracket locally, keeps results on your machine.

**Want to run the whole stack locally for development?** See the [Deployment Guide](docs/DEPLOYMENT.md). The legacy Docker worker (`worker/`) is still in the repo and works, but the desktop worker (`worker_flutter/`) is the path going forward.

```bash
# Frontend + API
npm run install:all && npm run dev
# → http://localhost:5173

# Desktop worker (Flutter)
cd worker_flutter && flutter run -d macos    # or: -d windows
```

## Key Features

*   **⚡ Parallel Simulation:** Runs multiple Forge instances concurrently. Capacity scales to your machine's CPU.
*   **📊 Win Rate Analysis:** Tracks per-deck win rates and game statistics across simulations.
*   **☁️ Cloud or Offline:** Sign in with Google to share compute across friends, or run a private bracket entirely on your laptop with the bundled precons.
*   **🖥️ Cross-platform desktop:** macOS (signed + notarized) and Windows. Auto-updates via Sparkle / WinSparkle.

## Documentation Map

*   **[Architecture Overview](docs/ARCHITECTURE.md):** Deep dive into the system design, Docker worker, and data flow.
*   **[Architecture Issues](docs/ARCHITECTURE_ISSUES.md):** Identified architecture issues and future improvements.
*   **[API Reference](API.md):** Authoritative reference for all system API endpoints (System, Jobs, Worker).
*   **[Data Flow](DATA_FLOW.md):** Detailed explanation of data transitions through the application.
*   **[Deployment Guide](docs/DEPLOYMENT.md):** Detailed setup instructions, prerequisites, and cloud deployment.
*   **[Implementation Plan](docs/IMPLEMENTATION_PLAN_WORKER_SPLIT.md):** Plan for the Worker + Simulation Split Architecture.
*   **[Mode Setup](docs/MODE_SETUP.md):** Configure for Local vs GCP operation.
*   **[Precon Sync](docs/PRECON_SYNC.md):** Daily synchronization of Firestore decks with Archidekt.
*   **[Remote Worker Setup](docs/DEPLOYMENT.md#remote-worker-headless-machine):** Deploy the worker on a separate machine with auto-updates via Watchtower.
*   **[Secrets Setup](docs/SECRETS_SETUP.md):** How to configure API keys and credentials.
*   **[Stale Job Sweeper](docs/STALE_SWEEPER.md):** Recovery net for stuck jobs (`POST /api/admin/sweep-stale-jobs`).
*   **[Sweeper Alerting](docs/SWEEPER_ALERTING.md):** Cloud Monitoring setup for the stale-job sweeper.

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) to get started.
