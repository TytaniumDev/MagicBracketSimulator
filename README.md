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

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) to get started.
