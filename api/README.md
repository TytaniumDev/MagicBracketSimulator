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

See [API.md](../API.md) for full endpoint documentation with request/response shapes.

| Route | Method(s) | Description |
|-------|-----------|-------------|
| `/api/jobs` | GET, POST | List jobs (paginated) / Create simulation job |
| `/api/jobs/[id]` | GET, DELETE | Job details (`?view=worker` adds decklists) / Admin delete |
| `/api/jobs/[id]/cancel` | POST | Cancel a QUEUED or RUNNING job |
| `/api/jobs/[id]/recover` | POST | One-shot recovery check for stuck jobs |
| `/api/jobs/[id]/simulations` | GET | List sims |
| `/api/jobs/[id]/simulations/[simId]` | PATCH | Worker updates individual simulation status |
| `/api/jobs/[id]/simulations/[simId]/lease` | POST | Worker extends a running sim's lease |
| `/api/jobs/[id]/logs` | POST | Ingest raw log batch |
| `/api/jobs/[id]/logs/simulation` | POST | Upload single simulation log file |
| `/api/jobs/[id]/logs/raw` | GET | Retrieve raw game logs |
| `/api/jobs/[id]/logs/condensed` | GET | Retrieve AI-condensed game logs |
| `/api/jobs/[id]/logs/structured` | GET | Retrieve structured (parsed) game logs |
| `/api/jobs/claim-sim` | GET | Worker atomically claims next pending simulation |
| `/api/jobs/bulk-delete` | POST | Admin bulk delete (max 50 jobs) |
| `/api/decks` | GET | List all decks (precons + community) |
| `/api/decks/create` | POST | Save a new deck (URL or text paste) |
| `/api/decks/[id]` | DELETE | Delete a deck (owner or admin only) |
| `/api/deck-color-identity` | GET | Resolve color identity for deck names |
| `/api/leaderboard` | GET | Win-rate leaderboard across all completed sims |
| `/api/workers` | GET | List active workers + queue depth |
| `/api/health` | GET | Unauthenticated system health check |
| `/api/health/workers` | GET | Lightweight worker pool health check |
| `/api/me` | GET | Current user profile + permissions |
| `/api/moxfield-status` | GET | Whether server-side Moxfield import is enabled |
| `/api/access-requests` | GET, POST | List / submit access requests |
| `/api/access-requests/approve` | GET | Approve a pending access request |
| `/api/coverage/config` | GET, PATCH | Coverage system configuration |
| `/api/coverage/status` | GET | Matchup coverage progress |
| `/api/coverage/next-job` | POST | Idle worker requests the next coverage job |
| `/api/sync/precons` | POST | Re-sync precon deck library |
| `/api/admin/backfill-ratings` | POST | Rebuild deck ratings from match history |
| `/api/admin/sweep-stale-jobs` | POST | Mark timed-out jobs as FAILED |

## Testing

```bash
npm run lint              # tsc --noEmit (type-check)
npm run test:unit         # game-logs.test.ts
npm run test:ingestion    # ingestion.test.ts
```
