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

Download the [latest release](https://github.com/TytaniumDev/MagicBracketSimulator/releases/latest) of the desktop worker and run it. The worker supports **Cloud** and **Offline** modes.

For full stack local development, refer to the [Deployment Guide](docs/DEPLOYMENT.md).

```bash
# Frontend + API
npm run install:all && npm run dev

# Desktop worker (Flutter)
cd worker_flutter && flutter run -d macos    # or: -d windows
```

## Key Features

*   **⚡ Parallel Simulation:** Runs multiple Forge instances concurrently. Capacity scales to your machine's CPU.
*   **📊 Win Rate Analysis:** Tracks per-deck win rates and game statistics across simulations.
*   **☁️ Cloud or Offline:** Sign in with Google to share compute across friends, or run a private bracket entirely on your laptop with the bundled precons.
*   **🖥️ Cross-platform desktop:** macOS (signed + notarized) and Windows. Auto-updates via Sparkle / WinSparkle.

## Documentation Map

*   [Architecture Overview](docs/ARCHITECTURE.md)
*   [Architecture Issues](docs/ARCHITECTURE_ISSUES.md)
*   [API Reference](API.md)
*   [Data Flow](DATA_FLOW.md)
*   [Deployment Guide](docs/DEPLOYMENT.md)
*   [Implementation Plan](docs/IMPLEMENTATION_PLAN_WORKER_SPLIT.md)
*   [Mode Setup](docs/MODE_SETUP.md)
*   [Precon Sync](docs/PRECON_SYNC.md)
*   [Secrets Setup](docs/SECRETS_SETUP.md)
*   [Stale Sweeper](docs/STALE_SWEEPER.md)
*   [Sweeper Alerting](docs/SWEEPER_ALERTING.md)
*   [Sweeper Alert Policy](docs/sweeper-alert-policy.yaml)
*   [Worker Flutter App Check Setup](worker_flutter/docs/APP_CHECK_SETUP.md)
*   [Worker Flutter Auth Setup](worker_flutter/docs/AUTH_SETUP.md)
*   [Worker Flutter Sentry Setup](worker_flutter/docs/sentry-setup.md)

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) to get started.
