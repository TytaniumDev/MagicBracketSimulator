# Worker

Slim Node.js Docker image (~100MB) that runs Forge simulations by spawning one simulation container per sim. Runs on any machine with Docker. The desktop worker in `worker_flutter/` is the path going forward; this one is still supported.

**Transport:** HTTP polling of `GET /api/jobs/claim-sim` in both local and GCP modes (there is no Pub/Sub). See `DATA_FLOW.md` §0 for claiming, sim leases and reporting.

## Structure

- `src/worker.ts` — Poll loop (`pollForSims`), per-sim processing, lease keeping, heartbeat, `Semaphore`
- `src/docker-runner.ts` — Runs simulation containers, sizes capacity from CPU/RAM (`calculateLocalCapacity`)
- `src/worker-api.ts` — HTTP server on `WORKER_API_PORT` (default 9090) for push control: config, cancel, notify, drain
- `src/condenser.ts` — Light parsing of winners and winning turns for status reports (full condensing happens in the API)
- `forge-engine/` — Headless Forge simulator assets (`run_sim.sh`, precon decks)
- `Dockerfile` — Worker image (Node.js + Docker CLI; no Java)
- `docker-compose.yml` — Production deployment (polls the hosted API)
- `docker-compose.local.yml` — Local override (polls `localhost:3000`, no GCP credentials)
- `docker-compose.watchtower.yml` — Optional Watchtower for auto-updates from GHCR

## Run

```bash
# GCP mode (polls the hosted API)
docker compose -f worker/docker-compose.yml up

# Local mode (polling against localhost:3000)
docker compose -f worker/docker-compose.yml -f worker/docker-compose.local.yml up
```
