# Contributing to Magic Bracket Simulator

Thank you for your interest in contributing!

## Getting Started

1.  **Architecture:** Please read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) to understand the system design.
2.  **API:** Please read [docs/API.md](docs/API.md) for API endpoint details.
3.  **Setup:** Follow the prerequisites in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) to get your environment ready.

## Project Structure

*   **`api/`**: Next.js 15 app serving API routes and job management.
*   **`frontend/`**: React SPA (Vite + Tailwind v4 + Firebase Auth).
*   **`worker/`**: Node.js orchestrator that manages simulation containers (Docker).
*   **`simulation/`**: Docker image containing Java + Forge for running games.

## Development Workflow

1.  Fork the repository.
2.  Create a feature branch (`git checkout -b feature/amazing-feature`).
3.  Commit your changes (`git commit -m 'Add some amazing feature'`).
4.  Push to the branch (`git push origin feature/amazing-feature`).
5.  Open a Pull Request.

## Testing

Please ensure all tests pass before submitting your PR.

*   **API:** Run `npm run test:unit`, `npm run test:ingestion`, and `npm run test:integration` within `api/`.
*   **Frontend:** No specific test script. Verify changes visually via `npm run dev`.
*   **Worker:** Test locally by running `npm run dev` in `worker/` (requires Docker).
*   **Full Stack:** Run `npm run dev` in the root to start API & Frontend, and `npm run dev` in `worker/` to start the worker.
