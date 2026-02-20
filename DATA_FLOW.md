# Data flow: ingestion and computation after Forge simulation

High-level overview of how raw logs from the Forge simulation runner are
ingested and computed, which layer does what, and what data is sent over the
network at each step.

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
| 2    | **POST** `/api/jobs/:id/logs/simulation`     | Raw log upload: `{ filename, logText }`. `logText` is the full raw log string (can be large).                                                           |


Order in code: status is reported first (PATCH), then raw log is uploaded
(POST).

---

## 3. API (Next.js)

**When status is updated (PATCH simulations/[simId]):**

- Persists the simulation status (state, winners, winningTurns, etc.) in the job
store (SQLite or Firestore).
- If this is a transition to COMPLETED/CANCELLED and **all** simulations for the
job are COMPLETED or CANCELLED, it triggers `**aggregateJobResults(jobId)`**
in the background (does not block the PATCH response).
- FAILED sims are **not** terminal for aggregation — they get retried by the
recovery scanner (`recoverStaleSimulations`). Only COMPLETED/CANCELLED count
as "done".

**Other aggregation triggers:**

- **Recovery scanner** (`recoverStaleSimulations`, GCP mode only): if no
simulations need recovery and all are COMPLETED/CANCELLED, it fires
`aggregateJobResults`. Also retries FAILED sims by resetting them to PENDING
and re-publishing to Pub/Sub.
- **Job cancellation** (`POST /api/jobs/:id/cancel`): triggers aggregation so
`structured.json` gets created from whatever sims completed before
cancellation.

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
  4. `**setJobCompleted(jobId)`** — job status set to COMPLETED (or left
    CANCELLED if it was cancelled).

So: **condensing and structuring** of logs happens **only in the API**, during
aggregation, using the raw logs that workers previously uploaded.

**Legacy route (unused):**

- `**POST /api/jobs/:id/logs`** — bulk log ingest: accepts `{ gameLogs,
deckNames, deckLists }` all at once. Still exists in the codebase but is
unused by the current worker, which uploads per-simulation via
`/logs/simulation` instead.

---

## 4. Frontend

**Real-time (SSE):**

- **GET** `/api/jobs/:id/stream`
  - **Event types:**
    - **Default (unnamed) event** — job snapshot: `id`, `name`, `deckNames`,
    `status`, `simulations` (count), `gamesCompleted`, `parallelism`,
    `createdAt`, `startedAt`, `completedAt`, `durationMs`,
    `dockerRunDurationsMs`, `workerId`, `workerName`, `claimedAt`,
    `retryCount`, `errorMessage`. Conditionally: `queuePosition` and
    `workers` (only for QUEUED jobs), `deckLinks` (when deck IDs are set).
    - **Named `simulations` event** — `{ simulations: SimStatus[] }`: array
    of per-sim status (state, winners, winningTurns, durationMs, etc.).
  - `gamesCompleted` is **derived** from simulation statuses
  (`COMPLETED sims * GAMES_PER_CONTAINER`), not read from a stored counter.
  The stored `job.gamesCompleted` field is only a fallback.
  - No raw, condensed, or structured logs on the stream.
  - **LOCAL mode** uses server-side **2-second polling** with change
  detection (SQLite). **GCP mode** uses **Firestore `onSnapshot`** listeners
  for real-time push on both the job document and the simulations
  subcollection.

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

So the frontend only receives **job + sim status** on the stream and via GET
job; **raw/condensed/structured** are separate GETs that hit the artifacts
produced during API-side aggregation (or recomputed on demand).

---

## 5. Race conditions & guard rails

Three guards prevent double-counting and stale state in the simulation
reporting path:

1. **Terminal state guard** (`PATCH simulations/[simId]/route.ts`): Before
applying any state update, the handler checks whether the sim is already
COMPLETED or CANCELLED. If so, it returns `{ updated: false,
reason: 'terminal_state' }` and skips the write. This prevents stale Pub/Sub
redeliveries from regressing COMPLETED→RUNNING.

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

## End-to-end summary


| Layer                    | Processing                                                                                                                                                         | Network (data)                                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Simulation container** | Writes raw Forge log to stdout                                                                                                                                     | None                                                                                                                                         |
| **Worker**               | Reads stdout → one `logText`; splits and extracts winners/turns in memory                                                                                          | → **PATCH** status (winners, winningTurns, state, durationMs); → **POST** raw `logText`                                                      |
| **API**                  | Stores raw logs; on “all sims done” runs **aggregation**: read raw logs, **condense + structure** (api condenser), write condensed/structured + mark job COMPLETED | ← PATCH (status), ← POST (raw log); → **GET** job/stream (status only); → **GET** logs/raw, logs/condensed, logs/structured (when requested) |
| **Frontend**             | Displays job + sim status from stream/GET; fetches structured/raw/condensed only when needed                                                                       | ← SSE job + simulations; ← GET job; ← GET logs/structured, logs/raw, logs/condensed                                                          |


---

## Test coverage

### Existing coverage

| Flow step | Test file | What it covers |
|---|---|---|
| Condense pipeline | `api/lib/condenser/condenser.test.ts` | `condenseGame`, `condenseGames`, `splitConcatenatedGames`, `extractWinner`, `extractWinningTurn` |
| Structure pipeline | `api/lib/condenser/structured.test.ts` | `structureGame`, `structureGames` |
| Pipeline consistency | `api/lib/condenser/pipeline.test.ts` | raw → split → condense + structure → win tallies agree |
| Win tallying | `api/lib/condenser/win-tally.test.ts` | Win counting logic |
| Derive job status | `api/lib/condenser/derive-job-status.test.ts` | `deriveJobStatus` from sim states |
| Game log files | `api/test/game-logs.test.ts` | Local filesystem log utilities |
| Simulation wins | `api/test/simulation-wins.test.ts` | Simulation win extraction |
| SSE stream construction | `api/lib/stream-utils.test.ts` | `jobToStreamEvent` field mapping, `durationMs` computation, `gamesCompleted` fallback, conditional fields (queuePosition, workers, deckLinks) |
| Log store | `api/lib/log-store.test.ts` | `uploadSingleSimulationLog`, `getRawLogs`, `ingestLogs`, `getCondensedLogs`, `getStructuredLogs` (LOCAL mode, real filesystem + fixtures) |
| Status transition guards | `api/lib/store-guards.test.ts` | `conditionalUpdateSimulationStatus`: state transitions, terminal state rejection, retry paths, Pub/Sub redelivery scenario |
| Aggregation | `api/lib/job-store-aggregation.test.ts` | `aggregateJobResults`: guard conditions, main flow with real logs, CANCELLED handling, idempotency, FAILED sims not terminal |

### Coverage gaps (future work)

| Flow step | Gap | Priority |
|---|---|---|
| Worker condenser (`worker/src/condenser.ts`) | Functions tested in API condenser tests but worker's copy is separate — no worker-specific tests | Low (worker copy mirrors API) |
