# Data flow: ingestion and computation after Forge simulation

High-level overview of how raw logs from the Forge simulation runner are
ingested and computed, which layer does what, and what data is sent over the
network at each step.

---

## 0. Work dispatch (how a worker gets a simulation to run)

Both local and GCP modes share one path: a worker polls the API for the next
PENDING simulation it's allowed to run. There is no Pub/Sub subscription, no
server-side broker, no push delivery. Firestore (or SQLite) is the only work
queue.

1. **Job created:** `POST /api/jobs` (or `POST /api/coverage/next-job`) writes
   the job row and then calls `initializeSimulations(jobId, count)` to create
   one PENDING sim doc per container.
2. **Notify (best-effort):** the API fires `pushToAllWorkers('/notify', {})`
   to wake online workers immediately. If no worker is reachable, the next
   poll tick picks up the work. The Docker worker polls every 3 s while it
   finds work and backs off to `MAX_IDLE_POLL_MS` (default 60 s) while idle.
3. **Worker poll:** each worker runs a loop: acquire a semaphore slot, then
   `GET /api/jobs/claim-sim?workerId=...&workerName=...&lease=1`. The
   endpoint atomically flips the oldest claimable sim to RUNNING, promotes
   its job from QUEUED to RUNNING if this is its first claim, and returns
   `{ jobId, simId, simIndex }`. A 204 means no work. In Firestore the
   candidates come from two indexed collection-group queries read a page
   (10 sims) at a time: PENDING sims by `createdAt` (a job's sims share a
   timestamp and tie-break by path, so they come in index order), then
   RUNNING sims by expired `leaseExpiresAt`. Each candidate is claimed in a
   transaction that re-checks the sim and its job (QUEUED or RUNNING, not
   `flutter-local`, sims outstanding); a failed check moves on to the next
   candidate, up to 3 pages per query. The stale sweeper cancels sims whose
   job ended or was deleted so they don't sit at the front of the queue. With `lease=1` the sim is reserved until `leaseExpiresAt` (3 min);
   a RUNNING sim whose lease has run out counts as claimable, so another
   worker takes it over (see **Crash recovery**).
   Every response (200 or 204) carries the worker's current concurrency
   override in the `X-Max-Concurrent-Override` header so runtime changes
   propagate within one poll interval even when the push `/config` path is
   unreachable (worker behind NAT / `WORKER_API_URL` unset).
4. **Run:** the worker calls `GET /api/jobs/:id` for deck data, runs the
   simulation container, and reports status via
   `PATCH /api/jobs/:id/simulations/:simId` (see §2 below).
5. **Hold the lease:** while the sim runs, the worker calls
   `POST /api/jobs/:id/simulations/:simId/lease` with `{ workerId }` about
   once a minute (`keepSimLease` in `worker/src/sim-lease.ts`,
   `SimLeaseKeeper` in the desktop worker). The answer is `extended` (keep
   going), `cancelled` (the job was cancelled: stop and report CANCELLED) or
   `lost` (another worker holds the sim now: stop and report nothing).

**Crash recovery (sim leases, `api/lib/sim-lease.ts`):** if a worker dies
mid-sim, it stops extending the lease. Once `leaseExpiresAt` passes, the
next claim by any worker takes the sim over, and `recoverStaleJob` (called
by the stale-sweeper Cloud Scheduler job and by Cloud Tasks recovery) resets
it to PENDING. Idle workers write nothing for this. Sims claimed without a
lease (workers older than this change) keep the old check: the sim is reset
once its `workerId` is missing from the 120 s active-workers list.

**Active workers (presence):** the active-workers list comes from Realtime
Database `presence/{workerId}` entries (`shared/types/worker-presence.ts`):
an entry seen within the window counts as online. The Docker worker's
`POST /api/workers/heartbeat` writes its entry through the API every 60 s;
the desktop worker writes its own entry every 60 s with an onDisconnect
delete. The API reads presence for recovery (FAILED-sim retry, sims without
a lease) and for push; the frontend's `useWorkerStatus` subscribes to it.
None of this touches Firestore.
Stuck-for-too-long sims (> 2.5 h) and always-retryable FAILED sims are reset
to PENDING the same way and reclaimed by the next poll. The PATCH handler
drops a report whose `workerId` no longer owns the sim
(`{ updated: false, reason: 'not_owner' }`), so a worker that lost its lease
can't overwrite the new owner's result.

**Flutter desktop worker:** claims, extends leases and reports through the
same endpoints as the Docker worker (`worker_flutter/lib/worker/sim_api.dart`),
with the signed-in user's Firebase ID token instead of `X-Worker-Secret`
(`isWorkerOrAllowlistedUser` in `api/lib/worker-auth.ts`). It still listens
to Firestore for `simulations where state == PENDING`, but only as a
read-only signal to try a claim.

**No Pub/Sub anywhere in the dispatch path.** Replaced 2026-04-15 after a
single auth hiccup silently killed the subscription stream for three days.
Polling fetches fresh credentials on every request and is trivially
resilient to transient auth or network issues.

---

## 1. Simulation container (Docker)

- **Where:** Inside the simulation container (Java + Forge).
- **What happens:** Forge runs the games and writes a **raw text log** to
**stdout** (one concatenated log per container run, e.g. 4 games).
- **Network:** None. The log stays in the container until the process exits.

---

## 2. Worker (Node.js)

- **Where:** Same machine as Docker; the worker spawns the container and reads
its stdout.

**Processing (all in worker memory, no extra network):**

- `**docker-runner.ts`:** Reads stdout into a single string `logText` when the
container exits.
- `**worker.ts`** uses `**worker/src/condenser.ts**` only for lightweight
parsing:
  - `splitConcatenatedGames(logText)` → one string per game
  - `extractWinner(game)` / `extractWinningTurn(game)` per game
  → produces `winners[]` and `winningTurns[]` for status updates.
  The worker does **not** run the full condense/structure pipeline; that
  happens in the API.

**Network (worker → API):**


| Step | Endpoint                                     | Data sent                                                                                                                                               |
| ---- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | **PATCH** `/api/jobs/:id/simulations/:simId` | Status update: `state`, `workerId`, `workerName`, `durationMs`, `winners[]`, `winningTurns[]` (and on failure: `errorMessage`). Small JSON; no raw log. |
| 2    | **POST** `/api/jobs/:id/logs/simulation`     | Raw log upload: `{ filename, logText }`. `logText` is bounded to **10 MB** (`MAX_LOG_BYTES` in `api/lib/log-store.ts`); oversize uploads are rejected with HTTP 413.                                                          |


Order in code: the raw log is uploaded first (POST), then the status is
reported (PATCH). Reporting the job's last sim starts aggregation, which
reads the uploaded logs, so the upload has to land first. A failed upload is
logged and the status is still reported.

**Flutter desktop worker:** same two calls in the same order (`LogUploader`,
then `SimApi.reportResult`), through `ApiClient` with the signed-in user's
Firebase ID token; the API accepts that token in place of `X-Worker-Secret`
when the uid is in the Firestore `allowedUsers` collection
(`isWorkerOrAllowlistedUser` in `api/lib/worker-auth.ts`). The desktop
worker has no worker secret. A FAILED report does not count toward the
job's finished sims; stale-job recovery retries the sim.

**Log upload size cap:** `POST /api/jobs/:id/logs/simulation` enforces the
10 MB `MAX_LOG_BYTES` cap in three places:

1. **Content-Length header check** — rejects early with HTTP 413 before
   buffering the body into memory.
2. **Streaming byte counter** — reads the request body as a `ReadableStream`,
   accumulates chunks, and aborts with HTTP 413 as soon as the running total
   exceeds the cap plus JSON envelope overhead. This closes the
   `Transfer-Encoding: chunked` bypass where the Content-Length header is
   absent.
3. **Library defense-in-depth** — `uploadSingleSimulationLog()` in
   `api/lib/log-store.ts` re-checks `Buffer.byteLength(logText)` and throws
   before writing to GCS / the local filesystem.

**Worker behavior on 413:** the worker logs a warning and continues — it does
NOT retry the upload or fail the simulation. The sim is then reported as
COMPLETED without its raw log. The aggregation pipeline tolerates missing per-sim logs
(it falls back to whatever logs did upload). Operators: if you see
`[sim_NNN] Log upload failed: HTTP 413` in the worker logs, a Forge run
produced an unexpectedly large log — investigate the game (infinite loop?
runaway card interaction?) rather than raising the cap.

---

## 3. API (Next.js)

**When status is updated (PATCH simulations/[simId]):**

- Persists the simulation status (state, winners, winningTurns, etc.) in the job
store (SQLite or Firestore).
- Uses an **atomic counter** (`FieldValue.increment(1)` on
`completedSimCount`) to detect when all sims are done — O(1) instead of
scanning the entire subcollection. When `completedSimCount >= totalSimCount`,
triggers `**aggregateJobResults(jobId)`** in the background.
- FAILED sims are **not** terminal for aggregation — they get retried by the
worker locally (up to 2 retries) or by Cloud Tasks recovery. Only
COMPLETED/CANCELLED count as "done".

**Other aggregation triggers:**

- **Cloud Tasks recovery** (`POST /api/jobs/:id/recover`): scheduled at job
creation (T+10min). If the job is still active when the task fires, runs
`recoverStaleJob` once and reschedules for 5 more minutes. Replaces the
former background polling scanner.
- **Job cancellation** (`POST /api/jobs/:id/cancel`): triggers aggregation so
`structured.json` gets created from whatever sims completed before
cancellation.
- **Stale-job sweeper** (`POST /api/admin/sweep-stale-jobs`, see
`api/lib/stale-sweeper.ts` and `docs/STALE_SWEEPER.md`): fired by Cloud
Scheduler every 15 minutes. For each active job it (a) hard-fails any
job that has sat QUEUED for >3 days, (b) hard-cancels any sim whose baseline
age exceeds the 2h cap, (c) calls `recoverStaleJob`, and (d) explicitly
calls `aggregateJobResults(jobId)` when the cancel-and-recover pass
leaves the job with every sim in a terminal state (COMPLETED or
CANCELLED). Step (d) is the catch-all that unsticks jobs where a worker
died mid-sim before the dead-worker reclaim could complete the pipeline.
After that pass it cancels any PENDING/RUNNING sim whose job is already
FAILED or CANCELLED, so outdated workers can't keep claiming them.

**When raw log is uploaded (POST logs/simulation):**

- `**uploadSingleSimulationLog`** (log-store): writes the raw log to storage
only (local `logs-data/{jobId}/` or GCS). No parsing or aggregation here.

**When aggregation runs (`aggregateJobResults`):**

- **Where:** API server (job-store-factory + log-store).
- **Steps:**
  1. `**getRawLogs(jobId)`** — loads all raw logs for the job (from local disk
    or GCS).
  2. `**ingestLogs(jobId, rawLogs, deckNames, deckLists)**` (log-store):
    - `splitConcatenatedGames` on each uploaded log → list of per-game raw
     strings.
    - `**condenseGames(expandedLogs)**` — full condense pipeline
    (api/lib/condenser): filter, classify, turn metrics, etc. →
    `CondensedGame[]`.
    - `**structureGames(expandedLogs, deckNames)**` — full structure pipeline →
    `StructuredGame[]`.
  3. **Storage:**
    - **Local:** raw game files + `meta.json` (contains `condensed` and
     `structured`).
    - **GCP:** raw logs + `condensed.json` + `structured.json` in GCS.
  4. **Per-deck stats (fire-and-forget, job has 4 `deckIds`):**
    - `processJobForRatings` — win/game counters behind the leaderboard and
     deck page results, plus `pairGames` (games played against each other
     deck, every game counted whether or not its winner resolved). One
     transaction per job (`RatingStore.applyJob`) reads the job and its 4
     decks' `decks/{deckId}/stats/rating` docs (SQLite: `ratings` rows with a
     `pair_games` column), writes them back and sets the job's
     `appliedStats.ratings` (SQLite: `jobs.ratings_applied`), so re-running
     aggregation or `POST /api/admin/backfill-ratings` never double counts.
     There is no per-game record; per-game facts stay in `structured.json`.
    - `processJobForCardStats` (`api/lib/card-impact/service.ts`) — runs
     `parseGameCards` on the raw logs already loaded in step 1 (no extra log
     reads) and adds each game to the deck's card counters in one
     `decks/{deckId}/stats/cards` document (SQLite: `card_stats` table) via one
     read-modify-write per deck. The document lists counted job ids, so
     re-running aggregation or the `POST /api/admin/backfill-card-stats`
     backfill never double counts. The backfill (the leaderboard's admin
     "Rebuild card stats" button pages through it) batches each page of jobs
     into one write per deck, parsing each job's raw logs as it reads them
     (`parseCardStatsJob`) so only one job's logs are in memory at a time.
     Documents also carry `version`
     (`CARD_STATS_VERSION`); counters from an older parser are discarded on
     read and rebuilt by the next job or the backfill. `GET
     /api/decks/:id/card-impact` scores cards from these counters
     (`scoreCards`).
  5. **Legacy stats:** stats used to live in top-level `ratings/{deckId}`,
     `cardStats/{deckId}` and one `matchResults` doc per game.
     `legacy-deck-stats-migration.ts` moves them under each deck the first
     time a stat store is touched after deploy (pair counts and rated-job
     flags are rebuilt from `matchResults`), then records
     `config/legacyDeckStatsMigration`.
  5. `**setJobCompleted(jobId)`** — job status set to COMPLETED (or left
    CANCELLED if it was cancelled).

So: **condensing and structuring** of logs happens **only in the API**, during
aggregation, using the raw logs that workers previously uploaded.

**Life total tracking:** `calculateLifePerTurn()` in `api/lib/condenser/turns.ts`
parses Forge's native `Life: Life: PlayerName oldValue > newValue` log entries
(added in Forge 2.0.11 via Card-Forge/forge#9845; 2.0.11 printed `->`, 2.0.12+
prints `>`, and both are accepted). This gives absolute life totals directly
from the game engine — no heuristic inference needed. For logs from Forge
2.0.10 and earlier (no life entries), the
function returns an empty object `{}` so the frontend can detect that life data
is unavailable rather than showing misleading defaults.

**Deck name matching:** `matchesDeckName()` from `api/lib/condenser/deck-match.ts`
is the canonical function for matching Forge log player names (e.g.
`"Ai(2)-Blood Rites - The Lost Caverns of Ixalan Commander"`) against short
deck names stored in the DB (e.g. `"Blood Rites"`). It handles exact match,
`Ai(N)-` prefix with endsWith, and precon set suffixes (startsWith after
stripping the Ai prefix). A frontend copy lives at
`frontend/src/utils/deck-match.ts`.

**Legacy route (unused):**

- `**POST /api/jobs/:id/logs`** — bulk log ingest: accepts `{ gameLogs,
 deckNames, deckLists }` all at once. Still exists in the codebase but is
unused by the current worker, which uploads per-simulation via
`/logs/simulation` instead.

---

## 4. Frontend

**Real-time streaming (Firestore onSnapshot + TanStack Query):**

- **GCP mode: Firestore `onSnapshot` direct streaming**
  - Frontend listens directly to Firestore via `onSnapshot` (WebSocket-based).
  - Cloud Run is **not** in the real-time path — zero persistent connections.
  - Firestore paths: `jobs/{jobId}` for job-level data, `jobs/{jobId}/simulations/{simId}` for per-sim data.
  - The `useJobStream` hook manages Firestore listeners with automatic cleanup.
  - Real-time field updates (status, gamesCompleted, results, etc.) are pushed into TanStack Query's cache via `queryClient.setQueryData()`.
  - **Terminal state guard:** Once the cached job data has a terminal status,
    `mergeFirestoreJobUpdate` returns early without applying the Firestore
    snapshot. This prevents stale Firestore cache data from overwriting
    complete REST API responses (which include deckLinks, colorIdentity, etc.).
  - **Conditional final REST fetch:** When Firestore reports a terminal status,
    a final REST fetch is only performed if the job *transitioned* to terminal
    (i.e., the user was watching a running job). If the initial REST response
    already returned a terminal job, the fetch is skipped to avoid redundancy.

- **Pod run page (`usePodRunJobs`)**
  - Loads each pod's job with the same one-shot read and `['job', id]` cache key as the job page.
  - GCP mode: pods are split by position into batches of 30 (Firestore's `in` limit). Each batch that still has an unfinished pod gets one `onSnapshot` on `jobs where documentId in [...]`, merged with `mergeFirestoreJobUpdate`; the listener is dropped once every pod in its batch is terminal.
  - LOCAL mode: each unfinished pod polls `GET /api/jobs/:id` every 5 seconds.
  - Standings only count pods with `results`, which aggregation writes before setting COMPLETED.

- **LOCAL mode: TanStack Query polling**
  - TanStack Query `refetchInterval` polls `GET /api/jobs/:id` and `GET /api/jobs/:id/simulations` every 2 seconds.
  - Polling stops automatically when the job reaches a terminal state.

- **Strategy: "REST base + real-time overlay"**
  - Initial data comes from REST (`GET /api/jobs/:id`) which provides the complete formatted `JobResponse` with computed fields (name, durationMs, deckLinks, colorIdentity).
  - In GCP mode, Firestore `onSnapshot` overlays real-time field updates on top of the cached REST data.
  - Both modes share the same TanStack Query cache — components are mode-agnostic.

- `gamesCompleted` is **derived** from the atomic `completedSimCount` counter
  (COMPLETED sims * GAMES_PER_CONTAINER). The stored `job.gamesCompleted`
  field is only a fallback.

**One-off job fetch:**

- **GET** `/api/jobs/:id`
  - Same kind of job payload (and deck links for UI). No logs.

**After job is COMPLETED/FAILED/CANCELLED (when UI needs logs):**

- **GET** `/api/jobs/:id/logs/structured`
  - Returns `{ games: StructuredGame[], deckNames?: string[] }` — precomputed
  structured games (e.g. for Deck Actions view).
- When the user opens the log panel:
  - **GET** `/api/jobs/:id/logs/raw` → raw log strings (e.g. `gameLogs[]`).
  - **GET** `/api/jobs/:id/logs/condensed` → precomputed `CondensedGame[]`.
- **Fallback computation:** if precomputed artifacts (`condensed.json`,
`structured.json`) don't exist (e.g. for FAILED jobs where aggregation
never ran), logs are recomputed on-the-fly from raw logs in `log-store.ts`.

So the frontend only receives **job + sim status** via Firestore onSnapshot
(GCP) or REST polling (local); **raw/condensed/structured** are separate GETs
that hit the artifacts produced during API-side aggregation (or recomputed on
demand).

---

## 5. Race conditions & guard rails

Three guards prevent double-counting and stale state in the simulation
reporting path:

1. **Terminal state guard** (`PATCH simulations/[simId]/route.ts`): Before
applying any state update, the handler checks whether the sim is already
COMPLETED or CANCELLED. If so, it returns `{ updated: false,
reason: 'terminal_state' }` and skips the write. This prevents a worker
that's just finishing a sim from writing stale RUNNING updates on top of a
COMPLETED status (e.g. if the sweeper reclaimed the sim concurrently).

2. **Conditional COMPLETED update** (`PATCH simulations/[simId]/route.ts`):
When transitioning to COMPLETED, uses `conditionalUpdateSimulationStatus`
which only applies the write if the sim's current state is PENDING, RUNNING,
or FAILED. If the sim was already COMPLETED (e.g. a retried duplicate
arrives), the update is skipped and aggregation is not triggered.

3. **Aggregation idempotency** (`aggregateJobResults` in
`job-store-factory.ts`): Checks `job.status !== 'COMPLETED' &&
job.status !== 'FAILED'` before running. If the job was already aggregated
(e.g. by a concurrent call from the scanner and the PATCH handler), the
second call exits immediately.

---

## 6. Auto-coverage system

The coverage system automatically queues simulation jobs to ensure all deck
pairs have sufficient game data for reliable Bayesian win-rate rankings.

**Configuration (stored in `coverage_config` table/Firestore doc):**

- `enabled` (boolean, default false) — toggle for the system
- `targetGamesPerPair` (number, default 400) — minimum games required per pair

**Coverage computation (`coverage-service.ts`):**

- Reads every deck's `pairGames` (`RatingStore.getPairGameCounts`: one
  collection-group query over the rating docs, one read per deck)
- Builds a pair → game count map (cached for 5 minutes)
- Compares against all possible pairs from `listAllDecks()`

**Pod generation (greedy algorithm):**

1. Pick the pair (A, B) with the fewest games played
2. Greedily add deck C that maximizes under-covered pairs with {A, B, C}
3. Greedily add deck D that maximizes under-covered pairs with {A, B, C, D}
4. Result: a 4-player pod covering up to 6 under-covered pairs

**Job creation flow (`POST /api/coverage/next-job`):**

- Auth: worker secret only (no Firebase auth)
- Guard: returns 200 with `{ reason }` if no work available. Possible reasons:
  `disabled`, `active-job-exists`, `all-pairs-covered`, `deck-resolution-failed`
- Creates a job with `simulations: 100`, `parallelism: 1`,
  `source: 'coverage'`
- Job enters the normal queue — same pipeline as user-created jobs

**Worker integration (`worker.ts` polling loop):**

- When no user jobs are queued, worker calls `POST /api/coverage/next-job`
- If a coverage job is created, worker immediately polls to pick it up
- User jobs always take priority — coverage only runs when idle

**Job `source` field:**

- `'user'` (default) — user-created via `POST /api/jobs`
- `'coverage'` — system-generated by the coverage system
- Stored in `jobs` table (SQLite) / Firestore doc
- Coverage jobs skip user rate limiting

**API endpoints:**

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /api/coverage/config` | Any authenticated user | Read coverage config |
| `PATCH /api/coverage/config` | Admin only | Toggle enabled, set target |
| `GET /api/coverage/status` | Any authenticated user | Pair coverage progress |
| `POST /api/coverage/next-job` | Worker secret | Generate and queue next pod |

**Frontend (Leaderboard page):**

- Progress bar: shows covered/total pairs and percentage
- Admin toggle: enables/disables the coverage system
- Target selector: configurable target games per pair (100, 200, 400, 800)

---

## End-to-end summary


| Layer                    | Processing                                                                                                                                                         | Network (data)                                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Simulation container** | Writes raw Forge log to stdout                                                                                                                                     | None                                                                                                                                         |
| **Worker**               | Reads stdout → one `logText`; splits and extracts winners/turns in memory; retries failed containers locally (2 attempts, 30s backoff)                             | → **PATCH** status (winners, winningTurns, state, durationMs); → **POST** raw `logText`                                                      |
| **API**                  | Stores raw logs in Firestore/SQLite; atomic counter check on completion; runs **aggregation**: read raw logs, **condense + structure**, write artifacts + mark COMPLETED; cancels Cloud Tasks | ← PATCH (status), ← POST (raw log); → **GET** logs/raw, logs/condensed, logs/structured (when requested) |
| **Frontend**             | Listens to Firestore `onSnapshot` (GCP) or polls REST via TanStack Query (local); fetches structured/raw/condensed only when needed                                                                   | ← **Firestore** onSnapshot (GCP) or REST polling (local); ← GET job; ← GET logs/structured, logs/raw, logs/condensed                                         |


---

## Test coverage

### Existing coverage

| Flow step | Test file | What it covers |
|---|---|---|
| Condense pipeline | `api/lib/condenser/condenser.test.ts` | `condenseGame`, `condenseGames`, `splitConcatenatedGames`, `extractWinner`, `extractWinningTurn` |
| Structure pipeline | `api/lib/condenser/structured.test.ts` | `structureGame`, `structureGames` |
| Pipeline consistency | `api/lib/condenser/pipeline.test.ts` | raw → split → condense + structure → win tallies agree |
| Win tallying | `api/lib/condenser/win-tally.test.ts` | Win counting logic |
| Deck name matching | `api/lib/condenser/deck-match.test.ts` | `matchesDeckName`, `resolveWinnerName` — handles precon set suffixes (e.g. "Blood Rites - The Lost Caverns of Ixalan Commander" → "Blood Rites") |
| Derive job status | `api/lib/condenser/derive-job-status.test.ts` | `deriveJobStatus` from sim states |
| Game log files | `api/test/game-logs.test.ts` | Local filesystem log utilities |
| Simulation wins | `api/test/simulation-wins.test.ts` | Simulation win extraction |
| Log store | `api/lib/log-store.test.ts` | `uploadSingleSimulationLog`, `getRawLogs`, `ingestLogs`, `getCondensedLogs`, `getStructuredLogs` (LOCAL mode, real filesystem + fixtures) |
| Status transition guards | `api/lib/store-guards.test.ts` | `conditionalUpdateSimulationStatus`: state transitions, terminal state rejection, retry paths, concurrent update scenarios |
| Per-sim claim | `api/lib/claim-sim.test.ts` | `claimNextSim` (SQLite): oldest-first ordering, job promotion QUEUED→RUNNING, sim RUNNING update, skipping terminal jobs; leases: taking over an expired lease, `extendSimLease` extended/cancelled/lost |
| Sim lease rules | `api/lib/sim-lease.test.ts`, `worker/src/sim-lease.test.ts`, `worker_flutter/test/worker/sim_lease_keeper_test.dart` | Expiry and claimability, lease extension answers, worker-side keeper stops on cancelled/lost and retries failed calls, idle poll backoff |
| Desktop worker API calls | `worker_flutter/test/worker/sim_api_test.dart`, `worker_flutter/test/worker/worker_engine_test.dart` | Claim with `lease=1`, lease and PATCH bodies; engine uploads the log before reporting, reports CANCELLED on a cancelled lease and nothing on a lost one |
| Worker endpoint auth | `api/lib/worker-auth.test.ts` | `isWorkerOrAllowlistedUser`: worker secret, allowlisted user token, rejects non-allowlisted/invalid tokens |
| Worker presence | `api/test/worker-presence.test.ts`, `worker_flutter/test/worker/worker_presence_test.dart` | Which entries count as online (stale window, updating window), mapping to `WorkerInfo`; desktop writes on connect/reconnect and each tick, arms the onDisconnect delete, removes on stop |
| Flutter log upload | `worker_flutter/test/worker/log_uploader_test.dart` | Endpoint, bearer-token auth, signed-out no-op, non-throwing on errors |
| Aggregation | `api/lib/job-store-aggregation.test.ts` | `aggregateJobResults`: guard conditions, main flow with real logs, CANCELLED handling, idempotency, FAILED sims not terminal |
| Card impact | `api/lib/card-impact/card-impact.test.ts`, `api/test/card-stats-store.test.ts` | `parseGameCards` on Forge 2.0.10 and 2.0.15 logs (including cards that enter without being cast and stolen cards), `addGame`/`scoreCards` lifts, store idempotency per job and version rebuilds |
| SimulationGrid resilience | `frontend/src/components/SimulationGrid.test.tsx` | Grid handles undefined `index`, `totalSimulations=0`, `totalSimulations=undefined` |
| JobStatus page | `frontend/src/pages/JobStatus.test.tsx` | Renders all job states (queued, running, completed, failed, cancelled), admin controls, Run Again button |

### Coverage gaps (future work)

| Flow step | Gap | Priority |
|---|---|---|
| Worker condenser (`worker/src/condenser.ts`) | Functions tested in API condenser tests but worker's copy is separate — no worker-specific tests | Low (worker copy mirrors API) |
