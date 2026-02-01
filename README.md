# MagicBracketSimulator

An attempt to better figure out commander brackets through simulation.

## Repo layout

- **frontend/** – The **web UI** (Vite + React). This is the only user-facing app; run it for the simulator interface at http://localhost:5173.
- **orchestrator-service/** – API and worker: deck ingestion, job store, simulation orchestration. Serves APIs consumed by the frontend.
- **analysis-service/** – Python service that analyzes simulation logs.
- **forge-simulation-engine/** – Docker-based Forge simulation runner.

## Running the full app

**Prerequisites:** Node.js 18+, Python 3.11+ with [uv](https://github.com/astral-sh/uv), Docker (with `forge-sim` image built). See [orchestrator-service/README.md](orchestrator-service/README.md) and [analysis-service/README.md](analysis-service/README.md) for setup (`.env` files, `GEMINI_API_KEY`, etc.).

### One command (from repo root)

```bash
npm install
npm run dev
```

Starts the Analysis Service (port 8000), Orchestrator API (port 3000), and **Frontend** (port 5173) in one terminal. Open **http://localhost:5173** in your browser for the web UI.

### Windows: double-click launcher

1. Run `npm install` once from the repo root (if you haven’t already).
2. Double-click **Start-MagicBracket.bat** to start both services in one window.
3. Close the window (or press Ctrl+C) to stop.

(To use the new frontend, run `npm run frontend` from the repo root in a separate terminal and open http://localhost:5173.)
