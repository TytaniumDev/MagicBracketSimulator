# Automatic Deck Coverage System

**Date:** 2026-04-07
**Status:** Approved

## Goal

Continuously establish power rankings across all decks (precons and custom) by automatically queuing 4-player pod games for under-covered deck pairs when the worker is idle. The system reuses all existing infrastructure — job queue, worker, TrueSkill ratings — and adds only the coverage logic and a frontend toggle.

## Coverage Model

**Pairwise coverage.** Every pair of decks must appear together in at least one 4-player pod. Since Commander games are 4-player, each pod covers C(4,2) = 6 pairs simultaneously. This is far more efficient than enumerating all C(n,4) pods.

Coverage is derived from the existing `match_results` table — each row stores `deck_ids` (JSON array of 4 deck IDs). For each game, all 6 pairs are extracted and counted. No new tracking table is needed.

**Scope:** All decks in the system — both precons (SQLite) and custom/saved decks.

## Coverage Config

A new `coverage_config` record stored in the database (SQLite table or Firestore document, via factory pattern):

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | boolean | `false` | Whether auto-coverage is active |
| `targetGamesPerPair` | number | `400` | Minimum games required per pair |
| `updatedAt` | timestamp | — | Last config change |
| `updatedBy` | string | — | Email of user who last changed config |

**Storage implementation:** `coverage-store-factory.ts` follows existing factory pattern, returning SQLite or Firestore implementation based on mode detection.

## Pod Generation Algorithm

When the API receives a request for the next coverage job, it generates an optimal pod using a greedy heuristic:

1. Fetch all deck IDs (precons + custom) from deck stores.
2. Query `match_results` to compute pair coverage — for each game, extract all 6 pairs from the 4 deck IDs and count occurrences.
3. Build the set of under-covered pairs: pairs with fewer games than `targetGamesPerPair`.
4. If no under-covered pairs remain, return nothing (coverage is complete).
5. Greedy pod selection:
   a. Pick the pair (A, B) with the fewest games played.
   b. From remaining decks, pick deck C that maximizes the number of additional under-covered pairs in {A, B, C}.
   c. From remaining decks, pick deck D that maximizes the number of additional under-covered pairs in {A, B, C, D}.
   d. Return pod [A, B, C, D].

**Complexity:** O(n) per pod generation, where n is the total number of decks. No enumeration of O(n^4) candidates.

**One pod per request.** The worker asks for one job at a time. This keeps things simple and self-regulating — no batch queue to manage.

**Edge case — fewer than 4 decks:** If the system has fewer than 4 decks total, the endpoint returns 204 (no work). Coverage requires at least 4 decks.

## Job Configuration

Each coverage job is created with:

| Parameter | Value | Rationale |
|---|---|---|
| `simulations` | `100` | Strong statistical signal per pod |
| `parallelism` | `1` | Minimal worker resource impact |
| `source` | `"coverage"` | Distinguishes from user-created jobs |

Since `GAMES_PER_CONTAINER = 4`, each job spawns 25 containers run sequentially (parallelism 1). With `targetGamesPerPair = 400`, the system queues up to 4 jobs per pair over time.

## Job Schema Addition

Add a `source` field to the Job type:

```typescript
source?: "user" | "coverage";  // default "user"
```

Stored in the `jobs` table (`source TEXT DEFAULT 'user'`) and Firestore documents.

**Impact on existing features:**
- **Rate limiting:** Coverage jobs skip user rate limits (system-generated).
- **Auth:** Coverage job creation is authorized via `WORKER_SECRET`, not Firebase auth.
- **Job history:** Coverage jobs appear in listings, visually tagged as automated.
- **TrueSkill:** No changes. `processJobForRatings()` processes coverage jobs identically.
- **Leaderboard:** No changes. Coverage game results feed into the same rating system.

## API Endpoints

### `GET /api/coverage/config`

- **Auth:** Any authenticated user (read-only).
- **Response:** `{ enabled, targetGamesPerPair, updatedAt, updatedBy }`

### `PATCH /api/coverage/config`

- **Auth:** Admin only (`verifyAllowedUser()`).
- **Body:** `{ enabled?: boolean, targetGamesPerPair?: number }`
- **Validation:** `targetGamesPerPair` must be between 1 and 10000.
- **Side effect:** Writes to coverage config store.

### `POST /api/coverage/next-job`

- **Auth:** Worker secret (`WORKER_SECRET` header).
- **Logic:**
  1. Read coverage config. If not enabled, return `204 No Content`.
  2. Fetch all decks, compute pair coverage from `match_results`.
  3. If all pairs meet `targetGamesPerPair`, return `204 No Content`.
  4. Generate optimal pod via greedy algorithm.
  5. Create a job with `simulations: 100`, `parallelism: 1`, `source: "coverage"`.
  6. Return the created job (same response shape as `POST /api/jobs`).
- **Note:** The job enters the normal queue. The worker picks it up through existing polling/Pub/Sub.

### `GET /api/coverage/status`

- **Auth:** Any authenticated user.
- **Response:** `{ totalPairs, coveredPairs, underCoveredPairs, targetGamesPerPair, percentComplete }`
- **Purpose:** Frontend progress display.

## Worker Integration

The worker's idle loop is modified to request coverage work before sleeping:

1. Worker finishes a job or finds no queued jobs.
2. Before sleeping, call `POST /api/coverage/next-job` (with worker secret).
3. If `204` — no coverage work available, sleep as normal.
4. If a job is returned — it's already created as QUEUED in the job store. The worker picks it up through normal job processing (polling or Pub/Sub notification).
5. After completing the coverage job, loop back to step 1.

**Key behaviors:**
- User-submitted jobs always take priority — coverage only runs when the queue is empty.
- `parallelism: 1` keeps resource usage minimal.
- Worker doesn't need to know about coverage logic — it just asks for work and processes normal jobs.
- No new worker config push needed — the API is the gatekeeper via the enabled flag.

## Frontend: Leaderboard Coverage Section

An admin section added to the existing Leaderboard page:

**Admin controls (visible to admins only):**
- Toggle switch for `enabled`
- Numeric input for `targetGamesPerPair` (default 400)

**Progress display (visible to all authenticated users):**
- Progress bar or text: "X / Y pairs covered (Z%)"
- Data sourced from `GET /api/coverage/status`

## File Changes Summary

### New Files
- `api/lib/coverage-store-factory.ts` — Factory for coverage config storage
- `api/lib/coverage-service.ts` — Pair coverage computation and pod generation algorithm
- `api/app/api/coverage/config/route.ts` — GET/PATCH config endpoints
- `api/app/api/coverage/next-job/route.ts` — POST next-job endpoint
- `api/app/api/coverage/status/route.ts` — GET status endpoint

### Modified Files
- `api/lib/types.ts` — Add `source` field to Job type
- `api/lib/db.ts` — Add `coverage_config` table, add `source` column to `jobs` table
- `api/lib/job-store-factory.ts` — Persist and read `source` field
- `worker/src/worker.ts` — Add coverage job request to idle loop
- `frontend/src/pages/Leaderboard.tsx` — Add coverage controls section
- `frontend/src/api.ts` — Add coverage API client functions
- `shared/types/job.ts` — Add `source` to Job interface

## Out of Scope

- Materialized pair coverage table (optimize later if query becomes slow)
- Scheduling infrastructure (cron, Cloud Scheduler) — manual or worker-driven only
- Coverage across specific subsets of decks (e.g., "only precons from set X")
- Head-to-head matchup statistics page (future feature that could use this data)
