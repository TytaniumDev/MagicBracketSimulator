# Contributing to Magic Bracket Simulator

Thank you for your interest in contributing!

## Getting Started

1.  **Architecture:** Please read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) to understand the system design (GCP vs Local Mode).
2.  **Setup:** Follow the prerequisites in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) and [docs/MODE_SETUP.md](docs/MODE_SETUP.md) to get your environment ready.
    -   **Local Mode:** Requires Docker and Node.js.
    -   **GCP Mode:** Requires GCP Project + Docker (for Unified Worker) or local Forge install.

## Project Structure

*   `orchestrator-service/`: Next.js API (decks, jobs, analysis). The core of the system.
*   `frontend/`: React UI (Vite).
*   `local-worker/`: Source code for the "Unified Worker" (GCP Mode).
*   `unified-worker/`: Docker build context for the Unified Worker.
*   `forge-simulation-engine/`: Docker context for `forge-sim` (Local Mode).
*   `forge-log-analyzer/`: Log condensing service (Local Mode).
*   `analysis-service/`: Python/Gemini service (Local Mode).
*   `docs/`: Detailed documentation.

## Development Workflow

1.  Fork the repository.
2.  Create a feature branch (`git checkout -b feature/amazing-feature`).
3.  **Run Development Environment:**
    -   `npm run dev:local` (Starts Orchestrator, Frontend, Worker, Log Analyzer, Analysis Service).
    -   `npm run dev:gcp` (Starts Orchestrator, Frontend). Worker runs separately.
4.  Commit your changes (`git commit -m 'Add some amazing feature'`).
5.  Push to the branch (`git push origin feature/amazing-feature`).
6.  Open a Pull Request.

## Testing

Please ensure all tests pass before submitting your PR.

*   **Orchestrator Unit Tests:**
    ```bash
    cd orchestrator-service
    npm run test:unit
    ```
    This runs `game-logs.test.ts`, `ingestion.test.ts`, and `auth.test.ts`.

*   **Integration Tests:**
    ```bash
    cd orchestrator-service
    npm run test:integration
    ```

*   **Frontend Verification:**
    Since there are no automated frontend tests, verify your UI changes manually by running the app locally.
