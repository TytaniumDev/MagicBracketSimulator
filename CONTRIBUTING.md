# Contributing to Magic Bracket Simulator

Thank you for your interest in contributing!

## Getting Started

1.  **Architecture:** Please read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) to understand the system design.
2.  **Setup:** Follow the prerequisites in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) to get your environment ready.

## Project Structure

*   **`api/`**: Next.js 15 app serving API routes and job management.
*   **`frontend/`**: React SPA (Vite + Tailwind v4 + Firebase Auth).
*   **`worker_flutter/`**: Desktop worker (Flutter, macOS and Windows) that runs Forge simulations.

## Development Workflow

1.  Fork the repository.
2.  Create a feature branch (`git checkout -b feature/amazing-feature`).
3.  Commit your changes (`git commit -m 'Add some amazing feature'`).
4.  Push to the branch (`git push origin feature/amazing-feature`).
5.  Open a Pull Request.

## Security & Validation

*   **URL Parsing:** When validating user-provided URLs or parsing them from payloads, always use the `new URL()` constructor to verify proper structure. Explicitly verify the protocol (`http:` or `https:`) to prevent Server-Side Request Forgery (SSRF) and protocol injection attacks (e.g. `file://`, `javascript:`). Do not rely on simple regex checks like `/^https?:\/\//i`.

## Testing

Please ensure all tests pass before submitting your PR.

*   **API:** Run `npm run test:unit`, `npm run test:ingestion`, and `npm run test:integration` within `api/`.
*   **Frontend:** No specific test script. Verify changes visually via `npm run dev`.
*   **Desktop worker:** Run `flutter analyze --no-fatal-infos` and `flutter test` within `worker_flutter/`.
*   **Full Stack:** Run `npm run dev` in the root to start API & Frontend, and `flutter run -d macos` (or `-d windows`) in `worker_flutter/` for the worker.
