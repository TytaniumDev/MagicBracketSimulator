# Orchestrator Service

The API and worker for the Magic Bracket Simulator. Handles deck ingestion from Moxfield/Archidekt, manages simulation jobs, and serves the APIs consumed by the frontend. **The web UI lives in the repo root `frontend/` package**, not here.

## Features

- Import decks from Moxfield or Archidekt URLs
- Paste deck lists directly
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

3. Ensure the Forge Docker image is built:

```bash
cd ../forge-simulation-engine
docker build -t forge-sim .
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
- **In-Memory Job Store** - Simple Map-based storage (jobs lost on restart)
- **Integrated Worker** - Polls for jobs, spawns Docker containers, calls Analysis Service
- **CORS** - API allows requests from `http://localhost:5173` (frontend dev server).

## API Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/api/precons` | GET | List available preconstructed decks |
| `/api/jobs` | POST | Create a new simulation job |
| `/api/jobs/[id]` | GET | Get job status and results |

### Create Job Request

```json
{
  "deckUrl": "https://moxfield.com/decks/abc123",
  "opponentMode": "random",
  "simulations": 5
}
```

Or with deck text:

```json
{
  "deckText": "[Commander]\n1 Ashling the Pilgrim\n\n[Main]\n1 Sol Ring\n99 Mountain",
  "opponentMode": "specific",
  "opponentIds": ["lorehold-legacies", "elven-council", "prismari-performance"],
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

## Limitations

- **In-Memory Storage**: Jobs are lost when the server restarts
- **Single Worker**: Only one job processes at a time
- **Local Only**: Designed for local development/testing
