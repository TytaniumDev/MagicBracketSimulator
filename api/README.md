# API

Next.js 15 API server for Magic Bracket Simulator. Deployed via Firebase App Hosting (Cloud Run).

Handles deck ingestion, job lifecycle, simulation tracking, and serves the REST API consumed by the frontend. The web UI lives in `frontend/`, not here.

## Setup

```bash
npm install
cp .env.example .env  # edit as needed
npm run dev            # next dev on :3000
```

## Key Structure

```
api/
├── app/api/           # Next.js API routes (REST endpoints)
├── lib/               # Business logic, storage factories, deck resolution
├── scripts/           # One-off utilities (seed-decks, backfill, recompute)
├── Dockerfile         # Production image for Cloud Run
└── apphosting.yaml    # Firebase App Hosting config
```

## API Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/api/precons` | GET | List preconstructed decks |
| `/api/jobs` | GET/POST | List jobs / Create simulation job |
| `/api/jobs/[id]` | GET/PATCH/DELETE | Job status, update, delete |
| `/api/jobs/[id]/logs` | POST/GET | Submit/retrieve game logs |
| `/api/jobs/next` | GET | Claim next queued job (polling workers) |
| `/api/decks` | GET/POST | List/save decks |

## Testing

```bash
npm run lint              # tsc --noEmit (type-check)
npm run test:unit         # game-logs.test.ts
npm run test:integration  # integration.test.ts (requires running dev server)
npm run test:ingestion    # ingestion.test.ts
```
