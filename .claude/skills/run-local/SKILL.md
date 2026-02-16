---
name: run-local
description: Start the full local development stack (API + frontend, optionally worker)
disable-model-invocation: true
---

# Run Local Dev Stack

Start the Magic Bracket Simulator local development environment.

## Steps

1. **Start API + Frontend** by running `npm run dev` from the repo root. This launches:
   - API (Next.js) on http://localhost:3000
   - Frontend (Vite) on http://localhost:5173

2. **Ask the user** if they also want to start the local worker (Docker-based simulation orchestrator).

3. If yes, start the worker in a separate background shell:
   ```bash
   docker compose -f worker/docker-compose.yml -f worker/docker-compose.local.yml up --build
   ```
   This runs the worker in polling mode against the local API (no Pub/Sub needed).

## Notes

- The worker requires Docker to be running and the simulation image built (`docker build -f simulation/Dockerfile -t magic-bracket-simulation .` from repo root).
- API + frontend run via concurrently; both are visible in the same terminal output.
- Frontend expects API at localhost:3000 (configured in `frontend/public/config.json`).
