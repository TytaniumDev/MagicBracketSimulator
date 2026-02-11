# Orchestrator Service

The API and worker for the Magic Bracket Simulator. Handles deck ingestion from Moxfield/Archidekt/ManaBox, manages simulation jobs, and serves the APIs consumed by the frontend. **The web UI lives in the repo root `frontend/` package**, not here.

## Features

- Import decks from Moxfield, Archidekt, or ManaBox URLs only
- Select random or specific precon opponents
- Real-time job status tracking
- Display power bracket analysis results

## Prerequisites

- Node.js 18+
- Docker (with `forge-sim` image built)
- Analysis Service running (see `analysis-service/`)

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env` file (or copy from `.env.example`):

```env
ANALYSIS_SERVICE_URL="http://localhost:8000"
FORGE_ENGINE_PATH="../forge-simulation-engine"
```

3. Ensure the Forge Docker image is built (required for the worker):

```bash
cd ../forge-simulation-engine
docker build -t forge-sim .
```

**If the worker fails with** `Unknown option --decks` **or** `Usage: ... --user-deck ... --opponents ...`**:** the container is running an old entrypoint script. Rebuild the image from the current repo so it uses the `--decks` CLI:

```bash
cd ../forge-simulation-engine
docker build -t forge-sim --no-cache .
```

## Running

### Development Mode

```bash
npm run dev
```

The API will be available at http://localhost:3000. The root path shows a placeholder; use the **frontend** app (see repo root `frontend/`) for the web UI at http://localhost:5173.

The integrated worker will start automatically when the dev server starts, polling for queued jobs.

### Production Build

```bash
npm run build
npm start
```

## Architecture

- **Next.js 15+ App Router** - API routes only; the web UI lives in the repo root `frontend/` package and calls these APIs over HTTP.
- **SQLite Job Store** - Persistent storage in `data/jobs.db` (jobs survive restarts)
- **Integrated Worker** - Polls for jobs, spawns Docker containers, sends logs to Log Analyzer
- **On-Demand Analysis** - AI analysis (Gemini) is triggered by user action via `/api/jobs/[id]/analyze`, not automatically after simulations
- **CORS** - API allows origins from `CORS_ALLOWED_ORIGINS` (comma-separated); default `http://localhost:5173`. In production set e.g. `https://magic-bracket-simulator.web.app`.

## API Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/api/precons` | GET | List available preconstructed decks |
| `/api/jobs` | GET | List all jobs (past runs) |
| `/api/jobs` | POST | Create a new simulation job |
| `/api/jobs/[id]` | GET | Get job status and results |
| `/api/jobs/[id]` | DELETE | Delete a job (and its artifact directory) |
| `/api/jobs/[id]/analyze` | POST | Trigger on-demand AI analysis (Gemini) |
| `/api/decks` | GET | List saved decks |
| `/api/decks` | POST | Save a deck from URL or text |
| `/api/decks/[id]` | DELETE | Delete a saved deck |

### Create Job Request

```json
{
  "deckUrl": "https://moxfield.com/decks/abc123",
  "opponentMode": "random",
  "simulations": 5
}
```

## File Structure

```
orchestrator-service/
├── app/
│   ├── page.tsx              # Placeholder (links to frontend app)
│   └── api/                  # API routes
├── lib/
│   ├── job-store.ts          # In-memory job storage
│   ├── types.ts              # TypeScript types
│   ├── precons.ts            # Precon loader
│   ├── worker-loop.ts        # Background worker
│   └── ingestion/            # Deck parsing
├── middleware.ts             # CORS for /api/* (frontend at :5173)
└── instrumentation.ts        # Worker startup
```

## Testing

### Integration Tests

Run integration tests against the dev server:

```bash
# Start the dev server in one terminal
npm run dev

# Run tests in another terminal
npm run test:integration
```

### End-to-End Testing

For full end-to-end testing with all services:

1. Build and run the Forge Docker image:
```bash
cd ../forge-simulation-engine
docker build -t forge-sim .
```

2. Start the Analysis Service:
```bash
cd ../analysis-service
# Follow setup instructions in analysis-service/README.md
```

3. Start the Orchestrator:
```bash
npm run dev
```

4. Start the frontend (from repo root: `npm run frontend`) and open the UI at http://localhost:5173

## Recomputing logs for a job

If a job was run before the batched-games fix (e.g. 4 parallel runs × 3 games stored as 4 games instead of 12), you can force recomputation from the raw log files on disk:

1. **Raw logs must still exist** in `orchestrator-service/jobs/<jobId>/logs/` (the worker does not delete them by default).
2. **Log Analyzer must be running** (e.g. `http://localhost:3001`).
3. From the `orchestrator-service` directory:

```bash
npm run recompute-logs -- <jobId>
```

Example:

```bash
npm run recompute-logs -- c998d985-66d3-4048-9d97-80e6911123e4
```

This re-reads all game log files (including batched `job_<id>_runN_game_M.txt`), re-posts them to the Log Analyzer, and updates the job’s `games_completed` count. Refresh the job page to see the corrected game count and life totals.

If the raw logs were deleted, re-run the simulation (create a new job with the same deck and opponents) to get correct results.

## Limitations

- **Single Worker**: Only one job processes at a time
- **Local Only**: Designed for local development/testing
