# Data flow: ingestion and computation after Forge simulation

High-level overview of how raw logs from the Forge simulation runner are
ingested and computed, which layer does what, and what data is sent over the
network at each step.

---

## 0. Work dispatch (how a worker gets a simulation to run)

Both local and GCP modes share one path: the desktop worker
(`worker_flutter/`) asks the API for the next PENDING simulation it's allowed
to run. There is no Pub/Sub subscription, no server-side broker, no push
delivery. Firestore (or SQLite) is the only work queue.

1. **Job created:** `POST /api/jobs` (or `POST /api/coverage/next-job`) writes
   the job row and then calls `initializeSimulations(jobId, count)` to create
   one PENDING sim doc per container.
2. **Wake-up:** the desktop worker listens (read-only) to Firestore for
   `simulations where state == PENDING`. Each change, a finished sim or a
   capacity change starts its claim loop (`WorkerEngine._tryClaimLoop`).
3. **Claim:** while it has free capacity, the worker calls
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
4. **Run:** the worker calls `GET /api/jobs/:id?view=worker` for deck data
   (`JobLoader` keeps the last 8 jobs), runs the simulation as a local
   Forge process (`SimRunner`),
   and reports status via `PATCH /api/jobs/:id/simulations/:simId` (see §2
   below). Job docs list their 4 decks as `seats: [{deckId, name, link,
   colorIdentity}]`, filled from each deck when the job is created
   (`api/lib/job-seats.ts`). The worker view adds `decks: [{name, dck}]`
   in seat order, reading each deck's .dck content by id and caching it
   for 5 minutes (`api/lib/job-decks.ts`); aggregation reads deck lists the
   same way.
5. **Hold the lease:** while the sim runs, the worker calls
   `POST /api/jobs/:id/simulations/:simId/lease` with `{ workerId }` about
   once a minute (`SimLeaseKeeper`). The answer is `extended` (keep
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
an entry seen within the window counts as online. The desktop worker writes
its own entry every 60 s with an onDisconnect delete. The API reads presence
for recovery (FAILED-sim retry, sims without a lease) and health checks; the
frontend's `useWorkerStatus` subscribes to it.
None of this touches Firestore.
Stuck-for-too-long sims (> 2.5 h) and always-retryable FAILED sims are reset
to PENDING the same way and reclaimed by the next poll. The PATCH handler
drops a report whose `workerId` no longer owns the sim
(`{ updated: false, reason: 'not_owner' }`), so a worker that lost its lease
can't overwrite the new owner's result.

**Auth:** the desktop worker claims, extends leases and reports
(`worker_flutter/lib/worker/sim_api.dart`) with the signed-in user's
Firebase ID token. The worker routes check it with `verifyAllowedUser`,
like every other route.

**No Pub/Sub anywhere in the dispatch path.** Replaced 2026-04-15 after a
single auth hiccup silently killed the subscription stream for three days.
Polling fetches fresh credentials on every request and is trivially
resilient to transient auth or network issues.

---

## 1. Forge run (desktop worker)

- **Where:** On the worker's machine. `SimRunner`
(`worker_flutter/lib/worker/sim_runner.dart`) starts Forge as a local Java
process; Forge runs the games and writes a **raw text log** to **stdout**.
- **Processing:** `parseGameLog` reads the winner and winning turn of each
game from the log, mirroring `extractWinner` / `extractWinningTurn` in
`api/lib/condenser/turns.ts`, for the status report. The worker does **not**
run the full condense/structure pipeline; that happens in the API.

---

## 2. Worker reporting

**Network (worker → API):**


| Step | Endpoint                                     | Data sent                                                                                                                                               |
| ---- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | **PATCH** `/api/jobs/:id/simulations/:simId` | Status update: `state`, `workerId`, `workerName`, `durationMs`, `winners[]`, `winningTurns[]` (and on failure: `errorMessage`). Small JSON; no raw log. |
| 2    | **POST** `/api/jobs/:id/logs/simulation`     | Raw log upload: `{ filename, logText }`. `logText` is bounded to **10 MB** (`MAX_LOG_BYTES` in `api/lib/log-store.ts`); oversize uploads are rejected with HTTP 413.                                                          |


Order in code: the raw log is uploaded first (`LogUploader`), then the
status is reported (`SimApi.reportResult`), both through `ApiClient` with the
signed-in user's Firebase ID token. Reporting the job's last sim starts aggregation, which
reads the uploaded logs, so the upload has to land first. A failed upload is
logged and the status is still reported.

A FAILED report does not count toward the job's finished sims; stale-job
recovery retries the sim.

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
store (SQLite or Firestore). Firestore stores every time as a Timestamp
(sim `startedAt`, `completedAt`, `leaseExpiresAt` included); the API and
`SimulationStatus` carry them as ISO strings.
- Uses an **atomic counter** (`FieldValue.increment(1)` on
`completedSimCount`) to detect when all sims are done — O(1) instead of
scanning the entire subcollection. When `completedSimCount >= totalSimCount`,
triggers `**aggregateJobResults(jobId)`** in the background.
- FAILED sims are **not** terminal for aggregation — stale-job recovery
(Cloud Tasks or the sweeper) resets them to PENDING for a retry. Only
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
only (local `logs-data/{jobId}/game_NNN.txt` or GCS `jobs/{jobId}/raw/game_NNN.txt`,
one file per simulation holding its `GAMES_PER_CONTAINER` games). No parsing
or aggregation here. GCS objects are stored gzipped (`Content-Encoding:
gzip`, set by `uploadJobArtifact`; downloads decompress them), and there is
no lifecycle rule: raw logs are kept forever.

**When aggregation runs (`aggregateJobResults`):**

- **Where:** API server (job-store-factory + log-store).
- **Steps:**
  1. `**getRawLogs(jobId)`** — loads all raw logs for the job (from local disk
    or GCS) and splits each simulation's file into single games
    (`splitConcatenatedGames`). Every reader of raw logs goes through it.
  2. `**ingestLogs(jobId, rawLogs, deckNames, deckLists)**` (log-store):
    - `splitConcatenatedGames` on each log (a no-op on logs already split)
     → list of per-game raw strings.
    - `**condenseGames(expandedLogs)**` — full condense pipeline
    (api/lib/condenser): filter, classify, turn metrics, etc. →
    `CondensedGame[]`.
    - `**structureGames(expandedLogs, deckNames)**` — full structure pipeline →
    `StructuredGame[]`.
  3. **Storage:** only the derived data is written; raw logs stay as
     uploaded.
    - **Local:** `meta.json` (contains `condensed` and `structured`).
    - **GCP:** `condensed.json` + `structured.json` in GCS, gzipped.
  4. **Job results:** `computeJobResults` (`api/lib/job-results.ts`) turns
     each structured game's winner into a seat with `seatOfPlayer`
     (`api/lib/condenser/deck-match.ts`: deck name match, and the Forge
     player number `Ai(N)` when the same deck sits in two seats), then
     `setJobResults` stores `results: { gamesPlayed, seats: [{ wins,
     avgWinTurn }] }`, index-aligned with the job's `seats`. The frontend
     shows wins by deck name with `winsByName` (`shared/types/job.ts`).
  5. **Per-deck stats (fire-and-forget):**
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
  6. **Pod run standings (fire-and-forget, any job with results):**
     `PodRunStore.applyJob` copies the job's results up to its pod run, if
     it is in one. Each job in a run carries `podRunId` (SQLite:
     `jobs.pod_run_id`), and the run keeps per-deck totals in `standings`
     plus `podsWithResults` (SQLite: `pod_runs.standings_json`,
     `pods_with_results`). One transaction reads the job, adds its seats with
     `addPodResults` (`shared/types/pod-run.ts`) and sets the job's
     `appliedStats.podRun` (SQLite: `jobs.pod_run_applied`). Saving a run
     (`POST /api/pod-runs`) sets `podRunId` on each of its jobs and totals the
     ones that already have results in the same way, so a job finishing while
     its run is saved counts once.
  7. `**setJobCompleted(jobId)`** — job status set to COMPLETED (or left
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
    complete REST API responses.
  - **Conditional final REST fetch:** When Firestore reports a terminal status,
    a final REST fetch is only performed if the job *transitioned* to terminal
    (i.e., the user was watching a running job). If the initial REST response
    already returned a terminal job, the fetch is skipped to avoid redundancy.

- **Pod run page (`usePodRun`, `usePodRunJobs`)**
  - A saved run (`/pods/:id`) reads only `GET /api/pod-runs/:id`, whose `standings` are the run's stored totals ranked by `rankStandings`. While pods are left (`podsWithResults < podCount`) it refetches whenever an `onSnapshot` on `podRuns/{id}` fires (GCP mode) or every 5 seconds (LOCAL mode).
  - The pods list loads only when the user opens it, using `usePodRunJobs` below. `/pods?jobs=…` links (runs saved before runs were stored) always load every pod and sum standings from them with `aggregatePodStandings`.
  - `usePodRunJobs` loads each pod's job with the same one-shot read and `['job', id]` cache key as the job page.
  - GCP mode: pods are split by position into batches of 30 (Firestore's `in` limit). Each batch that still has an unfinished pod gets one `onSnapshot` on `jobs where documentId in [...]`, merged with `mergeFirestoreJobUpdate`; the listener is dropped once every pod in its batch is terminal.
  - LOCAL mode: each unfinished pod polls `GET /api/jobs/:id` every 5 seconds.
  - Standings only count pods with `results`, which aggregation writes before setting COMPLETED (and before copying them to the run).

- **LOCAL mode: TanStack Query polling**
  - TanStack Query `refetchInterval` polls `GET /api/jobs/:id` and `GET /api/jobs/:id/simulations` every 2 seconds.
  - Polling stops automatically when the job reaches a terminal state.

- **Strategy: "REST base + real-time overlay"**
  - Initial data comes from REST (`GET /api/jobs/:id`) which provides the complete formatted `JobResponse` with computed fields (name, durationMs). Each seat's deck link and colors are on the job doc itself.
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
| Sim lease rules | `api/lib/sim-lease.test.ts`, `worker_flutter/test/worker/sim_lease_keeper_test.dart` | Expiry and claimability, lease extension answers, worker-side keeper stops on cancelled/lost and retries failed calls |
| Desktop worker API calls | `worker_flutter/test/worker/sim_api_test.dart`, `worker_flutter/test/worker/worker_engine_test.dart` | Claim with `lease=1`, lease and PATCH bodies; engine uploads the log before reporting, reports CANCELLED on a cancelled lease and nothing on a lost one |
| Worker presence | `api/test/worker-presence.test.ts`, `worker_flutter/test/worker/worker_presence_test.dart` | Which entries count as online (stale window), mapping to `WorkerInfo`; desktop writes on connect/reconnect and each tick, arms the onDisconnect delete, removes on stop |
| Flutter log upload | `worker_flutter/test/worker/log_uploader_test.dart` | Endpoint, bearer-token auth, signed-out no-op, non-throwing on errors |
| Aggregation | `api/lib/job-store-aggregation.test.ts` | `aggregateJobResults`: guard conditions, main flow with real logs, CANCELLED handling, idempotency, FAILED sims not terminal |
| Job results per seat | `api/lib/job-results.test.ts`, `api/lib/condenser/deck-match.test.ts`, `api/test/job-decks.test.ts` | Wins and average winning turn per seat, the same deck in two seats, unmatched winners; `seatOfPlayer`; seats filled at job creation and decklists read by seat |
| Card impact | `api/lib/card-impact/card-impact.test.ts`, `api/test/card-stats-store.test.ts` | `parseGameCards` on Forge 2.0.10 and 2.0.15 logs (including cards that enter without being cast and stolen cards), `addGame`/`scoreCards` lifts, store idempotency per job and version rebuilds |
| Pod run standings | `api/test/pod-run-store.test.ts`, `frontend/src/utils/pods.test.ts`, `frontend/src/pages/PodRun.test.tsx` | Saving a run totals jobs that already have results, `applyJob` counts each job once and skips jobs in no run, a job stays in its first run, ranking; the saved run page shows stored standings and loads pods only when asked |
| SimulationGrid resilience | `frontend/src/components/SimulationGrid.test.tsx` | Grid handles undefined `index`, `totalSimulations=0`, `totalSimulations=undefined` |
| JobStatus page | `frontend/src/pages/JobStatus.test.tsx` | Renders all job states (queued, running, completed, failed, cancelled), admin controls, Run Again button |
