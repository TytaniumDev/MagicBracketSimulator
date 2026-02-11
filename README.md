<div align="center">

# Magic Bracket Simulator

[🚀 Launch App](https://magic-bracket-simulator.web.app) &nbsp;|&nbsp; [📖 Documentation](docs/ARCHITECTURE.md) &nbsp;|&nbsp; [🐞 Report Bug](https://github.com/TytaniumDev/MagicBracketSimulator/issues)

![Status](https://img.shields.io/badge/Status-Active-success) ![Platform](https://img.shields.io/badge/Platform-Web%20%7C%20Docker-blue)

Simulate thousands of Magic: The Gathering Commander games to predict tournament brackets.<br>
Powered by Forge, Docker, and Gemini AI.

![Magic Bracket Simulator UI](docs/images/hero-screenshot.png)

</div>

## Quick Start

Run the full stack locally with just two commands.

> **Prerequisites:** [Node.js](https://nodejs.org) 18+ and [uv](https://github.com/astral-sh/uv) (for AI analysis features).

```bash
# 1. Install dependencies
npm run install:all

# 2. Start the app (Frontend, API, Worker, Analysis)
npm run dev
```

Visit **http://localhost:5173** to start simulating. See [Deployment Guide](docs/DEPLOYMENT.md) for detailed setup.

## Key Features

*   **🤖 AI-Powered Analysis:** Uses Gemini to analyze game logs and determine power levels.
*   **⚡ Parallel Simulation:** Runs multiple Forge instances concurrently via Docker.
*   **📊 Bracket Prediction:** Automatically simulates brackets to predict tournament outcomes.
*   **☁️ Hybrid Architecture:** Runs fully locally or on Google Cloud Platform.

## Documentation Map

*   **[Architecture Overview](docs/ARCHITECTURE.md):** Deep dive into the system design, Docker worker, and data flow.
*   **[Deployment Guide](docs/DEPLOYMENT.md):** Detailed setup instructions, prerequisites, and cloud deployment.
*   **[Mode Setup](docs/MODE_SETUP.md):** Configure for Local vs GCP operation.
*   **[Secrets Setup](docs/SECRETS_SETUP.md):** How to configure API keys and credentials.

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) to get started.
