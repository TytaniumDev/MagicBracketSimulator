# Worker

Unified Docker image that runs Forge MTG simulations. Deployed to edge machines (Cloud Run or bare Docker).

**Modes:** HTTP polling (GCP or local) — auto-detected via `GOOGLE_CLOUD_PROJECT` env var.

## Structure

- `src/` — TypeScript worker: job processing, log condensing, API communication
- `forge-engine/` — Headless Forge simulator assets (run_sim.sh, precon decks)
- `Dockerfile` — Single image combining Node.js worker + Java/Forge + xvfb
- `docker-compose.yml` — Production deployment (GCP mode)
- `docker-compose.local.yml` — Local override (polling mode, no GCP credentials)

## Run

```bash
# GCP mode
docker compose -f worker/docker-compose.yml up

# Local mode (polling against localhost:3000)
docker compose -f worker/docker-compose.yml -f worker/docker-compose.local.yml up
```
