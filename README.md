# Magic Bracket Simulator

![Status](https://img.shields.io/badge/Status-Active-success)
![Platform](https://img.shields.io/badge/Platform-Web%20%7C%20Docker-blue)

[🚀 Launch App](https://magic-bracket-simulator.web.app) &nbsp;|&nbsp; [📖 Documentation](ARCHITECTURE.md) &nbsp;|&nbsp; [🐞 Report Bug](https://github.com/TytaniumDev/MagicBracketSimulator/issues)

---

Simulate thousands of Magic: The Gathering Commander games to predict tournament brackets. Powered by Forge, Docker, and Gemini AI.

![Magic Bracket Simulator UI](docs/images/hero-screenshot.png)

## Quick Start

Run the full stack locally with just two commands:

```bash
# 1. Install dependencies
npm run install:all

# 2. Start the app (Frontend, API, Worker, Analysis)
npm run dev
```

Visit **http://localhost:5173** to start simulating.

## Key Features

*   **🤖 AI-Powered Analysis:** Uses Gemini to analyze game logs and determine power levels.
*   **⚡ Parallel Simulation:** Runs multiple Forge instances concurrently via Docker.
*   **📊 Bracket Prediction:** Automatically simulates brackets to predict tournament outcomes.
*   **☁️ Hybrid Architecture:** Runs fully locally or on Google Cloud Platform.

## Documentation Map

*   **[Architecture Overview](ARCHITECTURE.md):** Deep dive into the system design, Docker worker, and data flow.
*   **[Deployment Guide](docs/DEPLOYMENT.md):** detailed setup instructions, prerequisites, and cloud deployment.
*   **[Secrets Setup](docs/SECRETS_SETUP.md):** How to configure API keys and credentials.

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) to get started.
