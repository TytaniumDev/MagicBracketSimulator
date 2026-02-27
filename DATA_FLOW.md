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
- Writes simulation progress to **Firebase RTDB** (fire-and-forget) for
real-time frontend streaming. The RTDB write includes the simulation `index`
(resolved from the job store or parsed from the simId) so the frontend can
build the simulation grid without waiting for a REST fallback.
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

**Real-time streaming:**

- **GCP mode: Firebase RTDB direct streaming** (new)
  - Frontend listens directly to RTDB via Firebase JS SDK (`onValue`).
  - Cloud Run is **not** in the real-time path — zero persistent connections.
  - RTDB path: `/jobs/{jobId}/` for job-level data, `/jobs/{jobId}/simulations/{simId}/` for per-sim data.
  - API writes to RTDB as a fire-and-forget side effect when updating Firestore.
  - RTDB data is **ephemeral** — deleted when jobs reach terminal state. Frontend falls back to REST for completed jobs.
  - The `useJobProgress` hook manages RTDB listeners with automatic cleanup.
  - Frontend defensively parses `index` from the simId key (`sim_003` → `3`)
    when RTDB data lacks it, and continues REST polling until valid indices
    are available.

- **LOCAL mode: SSE fallback** — **GET** `/api/jobs/:id/stream`
  - Server-side 2-second polling of SQLite with change detection.
  - **Event types:** same as before (default job event + named `simulations` event).
  - GCP mode returns **410 Gone** from this endpoint — frontend uses RTDB instead.

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
| **Worker**               | Reads stdout → one `logText`; splits and extracts winners/turns in memory; retries failed containers locally (2 attempts, 30s backoff)                             | → **PATCH** status (winners, winningTurns, state, durationMs); → **POST** raw `logText`                                                      |
| **API**                  | Stores raw logs + writes to RTDB; atomic counter check on completion; runs **aggregation**: read raw logs, **condense + structure**, write artifacts + mark COMPLETED; cleans up RTDB + Cloud Tasks | ← PATCH (status), ← POST (raw log); → **RTDB** writes; → **GET** logs/raw, logs/condensed, logs/structured (when requested) |
| **Frontend**             | Listens to RTDB directly (GCP) or SSE (local); fetches structured/raw/condensed only when needed                                                                   | ← **RTDB** onValue (GCP) or SSE (local); ← GET job; ← GET logs/structured, logs/raw, logs/condensed                                         |


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
| SSE stream construction | `api/lib/stream-utils.test.ts` | `jobToStreamEvent` field mapping, `durationMs` computation, `gamesCompleted` fallback, conditional fields (queuePosition, workers, deckLinks) |
| Log store | `api/lib/log-store.test.ts` | `uploadSingleSimulationLog`, `getRawLogs`, `ingestLogs`, `getCondensedLogs`, `getStructuredLogs` (LOCAL mode, real filesystem + fixtures) |
| Status transition guards | `api/lib/store-guards.test.ts` | `conditionalUpdateSimulationStatus`: state transitions, terminal state rejection, retry paths, Pub/Sub redelivery scenario |
| Aggregation | `api/lib/job-store-aggregation.test.ts` | `aggregateJobResults`: guard conditions, main flow with real logs, CANCELLED handling, idempotency, FAILED sims not terminal |
| RTDB sim parsing | `frontend/src/hooks/useJobProgress.test.ts` | `parseRtdbSimulations`: index fallback from simId, sorting, filtering, edge cases |
| SimulationGrid resilience | `frontend/src/components/SimulationGrid.test.tsx` | Grid handles undefined `index`, `totalSimulations=0`, `totalSimulations=undefined` |

### Coverage gaps (future work)

| Flow step | Gap | Priority |
|---|---|---|
| Worker condenser (`worker/src/condenser.ts`) | Functions tested in API condenser tests but worker's copy is separate — no worker-specific tests | Low (worker copy mirrors API) |
