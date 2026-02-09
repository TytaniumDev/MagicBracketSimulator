# Contributing to Magic Bracket Simulator

Thank you for your interest in contributing! We want to make it as easy as possible for you to get started.

## 📚 Architecture & Documentation

Before diving in, please familiarize yourself with the system:

1.  **Architecture Overview:** Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) to understand the high-level design, the two deployment modes (Local vs. GCP), and the "Unified Worker" concept.
2.  **Deployment Guide:** See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for detailed prerequisites and cloud setup.

## 🛠️ Environment Setup

### Prerequisites

*   **Node.js:** v20+
*   **Python:** v3.11+ (managed by `uv`)
*   **Docker:** Required for building and running the Forge simulation engine.

### Quick Start

1.  **Install Dependencies:**
    Run the following command from the root directory to install dependencies for all services (frontend, orchestrator, workers):
    ```bash
    npm run install:all
    ```

2.  **Setup Analysis Service (Python):**
    If you are working on the `analysis-service`, you need to install Python dependencies including dev tools:
    ```bash
    cd analysis-service
    uv sync --extra dev
    ```

3.  **Environment Variables:**
    Copy `.env.example` to `.env` in the relevant service directories (`orchestrator-service`, `local-worker`, `analysis-service`) and configure them as needed. See [docs/SECRETS_SETUP.md](docs/SECRETS_SETUP.md) for details.

## 🧪 Testing & Verification

We enforce testing to ensure stability. Please run the relevant tests for your changes.

### Orchestrator Service (`orchestrator-service/`)

*   **Linting:** `npm run lint` (uses `tsc --noEmit`)
*   **Unit Tests:** `npm run test:unit` (runs `tsx test/game-logs.test.ts`)
*   **Integration Tests:** `npm run test:integration` (runs `tsx test/integration.test.ts`)
*   **Ingestion Tests:** `npm run test:ingestion` (runs `tsx test/ingestion.test.ts`)

### Frontend (`frontend/`)

*   **Linting:** `npm run lint` (uses `eslint`)
*   **Build Check:** `npm run build` (verifies TypeScript and Vite build)

### Unified Worker (`local-worker/`)

*   **Development:** `npm run dev` (runs with `tsx`)
*   **Build:** `npm run build` (compiles to `dist/`)

## 📦 Development Workflow

1.  **Fork & Branch:** Create a feature branch (`git checkout -b feature/amazing-feature`).
2.  **Code:** Implement your changes.
3.  **Verify:** Run the tests mentioned above.
4.  **Commit:** Use descriptive commit messages.
5.  **Pull Request:** Open a PR and describe your changes.

## 📝 Documentation

*   If you change the architecture, update `docs/ARCHITECTURE.md`.
*   If you add new environment variables, update the relevant `.env.example` and `docs/SECRETS_SETUP.md`.
*   **Scribe's Rule:** Do not edit `README.md` directly for major changes; it is managed by the "Showcase" persona. Focus on technical docs in `docs/`.
