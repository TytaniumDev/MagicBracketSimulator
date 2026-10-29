# Magic Bracket Simulator API Documentation

This document describes the REST API for the Magic Bracket Simulator.

**Base URL:** `/api`

**Authentication:**

- Public endpoints require no auth.
- User endpoints require Firebase Auth: `Authorization: Bearer <firebase-id-token>`
- Worker endpoints require `X-Worker-Secret: <secret>` header.
- Admin endpoints require Firebase Auth **and** admin role on the account.

---

## Jobs

### List Jobs

`GET /jobs`

Returns paginated recent jobs. Supports `limit` and `cursor` query parameters.

**Query Parameters:**
- `limit` (optional, default 100, max 100): number of jobs to return
- `cursor` (optional): base64-encoded pagination cursor from a previous response

**Response:**

```json
{
  "jobs": [
    {
      "id": "job-uuid",
      "name": "Deck A vs Deck B vs Deck C vs Deck D",
      "deckNames": ["Deck A", "Deck B", "Deck C", "Deck D"],
      "status": "COMPLETED",
      "simulations": 100,
      "gamesCompleted": 100,
      "createdAt": "2024-01-15T10:00:00.000Z",
      "durationMs": 120000,
      "parallelism": 4,
      "startedAt": "2024-01-15T10:00:01.000Z",
      "completedAt": "2024-01-15T10:02:01.000Z",
      "dockerRunDurationsMs": [60000, 60000]
    }
  ],
  "nextCursor": "base64-cursor-or-null"
}
```

### Create Job

`POST /jobs`

Creates a new simulation job. Requires user auth.

**Body:**

```json
{
  "deckIds": ["id1", "id2", "id3", "id4"],
  "simulations": 100,
  "idempotencyKey": "optional-uuid"
}
```

**Response:**

```json
{
  "id": "new-job-uuid",
  "deckNames": ["Deck A", "Deck B", "Deck C", "Deck D"]
}
```

### Get Job Details

`GET /jobs/:id`

Returns detailed information about a specific job.

Workers get the worker view, which adds `decks: [{ name, dck }]` (the 4
decks with their .dck content) and is sent to requests with
`X-Worker-Secret`, or with `?view=worker` from an allowlisted user (the
desktop worker). `decks` is left out when a deck can no longer be found.

**Response:**

```json
{
  "id": "job-uuid",
  "status": "RUNNING",
  "simulations": 100,
  "gamesCompleted": 50,
  "deckNames": ["Deck A", "Deck B", "Deck C", "Deck D"],
  "deckIds": ["id1", "id2", "id3", "id4"],
  "deckLinks": ["https://...", null, "https://...", null],
  "errorMessage": null,
  "retryCount": 0,
  "queuePosition": 0,
  "workers": { "online": 2, "idle": 1, "updating": 0 },
  "createdAt": "2024-01-15T10:00:00.000Z",
  "startedAt": "2024-01-15T10:00:01.000Z",
  "completedAt": null,
  "durationMs": null,
  "dockerRunDurationsMs": null
}
```

### Cancel Job

`POST /jobs/:id/cancel`

Cancels a QUEUED or RUNNING job. Requires user auth (must be owner or admin).

**Response:**

```json
{ "id": "job-uuid", "status": "CANCELLED" }
```

### Recover Job

`POST /jobs/:id/recover`

One-shot recovery check for a stuck job (called by Cloud Tasks after a delay).
**Auth:** Worker auth required.

**Response:**

```json
{ "status": "ok", "recovered": true, "stillActive": false }
```

### Bulk Delete Jobs

`POST /jobs/bulk-delete`

Deletes multiple jobs (max 50) and their artifacts.
**Auth:** Admin access required.

**Body:**

```json
{ "jobIds": ["job-1", "job-2"] }
```

**Response:**

```json
{
  "deletedCount": 2,
  "results": [
    { "id": "job-1", "deleted": true },
    { "id": "job-2", "deleted": true }
  ]
}
```

### Claim Next Simulation (Worker)

`GET /jobs/claim-sim?workerId=worker-1&workerName=MyWorker&lease=1`

Atomically claims the next simulation for a worker: a PENDING sim, or a RUNNING
one whose lease ran out. With `lease=1` the sim is reserved for 3 minutes; the
worker keeps it by extending the lease (below) while it runs.
**Auth:** Worker secret, or an allowlisted user's Firebase ID token.

**Response:**

- `200 OK`: `{ "jobId": "...", "simId": "sim_000", "simIndex": 0 }`
- `204 No Content`: No simulations available.

---

## Simulations

### List Simulations

`GET /jobs/:id/simulations`

Returns status of all individual simulations for a job.

**Response:**

```json
{
  "simulations": [
    {
      "simId": "sim_000",
      "index": 0,
      "state": "COMPLETED",
      "workerId": "worker-1",
      "workerName": "MyWorker",
      "durationMs": 45000,
      "winner": "Deck A",
      "winningTurn": 8
    }
  ]
}
```

### Initialize Simulations (Worker)

`POST /jobs/:id/simulations`

Initializes simulation tracking for a job.
**Auth:** Worker auth required.

**Body:**

```json
{ "count": 25 }
```

### Update Simulation Status (Worker)

`PATCH /jobs/:id/simulations/:simId`

Updates the status of a single simulation.
**Auth:** Worker auth required.

**Body:**

```json
{
  "state": "COMPLETED",
  "workerId": "worker-1",
  "workerName": "MyWorker",
  "durationMs": 45000,
  "errorMessage": null,
  "winner": "Deck A",
  "winningTurn": 8
}
```

Valid `state` values: `PENDING`, `RUNNING`, `COMPLETED`, `FAILED`, `CANCELLED`

When `workerId` is given and another worker now holds the sim, the update is
dropped: `{ "updated": false, "reason": "not_owner" }`.
**Auth:** Worker secret, or an allowlisted user's Firebase ID token.

### Extend Simulation Lease (Worker)

`POST /jobs/:id/simulations/:simId/lease`

Pushes a running sim's lease back 3 minutes. Workers call it about once a minute.
**Auth:** Worker secret, or an allowlisted user's Firebase ID token.

**Body:**

```json
{ "workerId": "worker-1" }
```

**Response:** `{ "status": "extended" | "cancelled" | "lost" }`. On `cancelled`
the job was cancelled; on `lost` the sim is no longer this worker's. Either
way the worker stops the sim, and on `lost` it reports nothing.

---

## Logs

### Get Combined Logs

`GET /jobs/:id/logs`

Returns all logs for a job (raw and/or structured).

### Upload Simulation Log (Worker)

`POST /jobs/:id/logs/simulation`

Uploads the raw log for a completed simulation.
**Auth:** Worker auth required.

**Body:**

```json
{
  "filename": "raw/game_001.txt",
  "logText": "..."
}
```

### Get Raw Logs

`GET /jobs/:id/logs/raw`

Returns raw (unprocessed) game logs for a job.

### Get Condensed Logs

`GET /jobs/:id/logs/condensed`

Returns condensed AI-input logs (processed summary of each game).

### Get Structured Logs

`GET /jobs/:id/logs/structured`

Returns fully parsed, structured game-action logs (deck × turn granularity).

---

## Pod Runs

A pod run is one selection of more than 4 decks, queued as one job per 4-deck pod.

### Save Pod Run

`POST /pod-runs`

Body: `{ deckIds, jobIds, simulations, idempotencyKey? }`, sent once the run's jobs are queued. Records the run on each job and totals the jobs that already have results. Returns `{ id }`.

### List Pod Runs

`GET /pod-runs?limit=10` (max 50), or `GET /pod-runs?jobId=<id>` for the runs that include a job.

Returns `{ podRuns: PodRunSummary[] }`, each with `id`, `deckNames`, `podCount`, `podsWithResults`, `simulations` and `createdAt`.

### Get Pod Run

`GET /pod-runs/:id`

Returns the summary plus `deckIds`, `jobIds` and `standings`: one entry per deck that has played a finished pod (`key`, `name`, `pods`, `gamesPlayed`, `wins`, `winRate`, `avgWinTurn`), best first. Standings grow as each pod's job is aggregated.

## Decks

### List Decks

`GET /decks`

Lists all decks (precons and user-submitted). No auth required.

**Response:**

```json
{
  "decks": [
    {
      "id": "deck-uuid",
      "name": "Deck Name",
      "primaryCommander": "Commander Name",
      "colorIdentity": ["W", "U"],
      "isPrecon": false,
      "link": "https://moxfield.com/...",
      "setName": null,
      "ownerId": "user-uid",
      "ownerEmail": "user@example.com"
    }
  ]
}
```

### Create Deck

`POST /decks/create`

Creates a new deck from a URL (Moxfield, Archidekt, ManaBox) or raw deck-list text.
**Auth:** User auth required.

**Validation:** `deckUrl` and `deckLink` must be valid `http:` or `https:` URLs to prevent SSRF.

**Body (URL import):**

```json
{ "deckUrl": "https://moxfield.com/decks/..." }
```

**Body (manual paste):**

```json
{
  "deckText": "1 Sol Ring\n1 Command Tower...",
  "deckName": "My Custom Deck",
  "deckLink": "https://moxfield.com/decks/..."
}
```

**Response:**

```json
{ "id": "deck-uuid", "name": "My Custom Deck" }
```

### Get Deck

`GET /decks/:id`

Returns a deck's metadata, its parsed decklist, and its results across every
recorded game (`stats` is `null` until the deck has played). Powers the deck
page at `/decks/:id`. **Auth:** signed-in user.

A deck that left the deck library (e.g. a precon the Archidekt sync removed)
but still has a rating returns `decklistAvailable: false`, metadata from the
rating, and empty `commanders`/`cards`. Only an id with neither returns 404,
which is also reported to Sentry as a warning.

**Response:**

```json
{
  "deck": {
    "id": "deck-uuid",
    "name": "Temur Roar Upgraded",
    "primaryCommander": "Ureni of the Unwritten",
    "colorIdentity": ["G", "U", "R"],
    "isPrecon": false,
    "setName": null,
    "link": "https://moxfield.com/decks/..."
  },
  "decklistAvailable": true,
  "commanders": [{ "quantity": 1, "name": "Ureni of the Unwritten" }],
  "cards": [{ "quantity": 1, "name": "Sol Ring" }],
  "stats": {
    "rating": 41.2,
    "gamesPlayed": 212,
    "wins": 98,
    "winRate": 0.462,
    "avgWinTurn": 8.4,
    "winTurnHistogram": [0, 0, 0, 0, 1, 4, 12, 22, 25, 15, 9, 5, 3, 1, 1, 0]
  }
}
```

### Get Deck Content

`GET /decks/:id/content`

Returns the raw `.dck` text for a deck. Used by workers to download deck content.
**Auth:** Worker auth required.

**Response:**

```json
{ "name": "My Deck", "dck": "1 Sol Ring\n..." }
```

### Delete Deck

`DELETE /decks/:id`

Deletes a deck. Must be the owner or admin.
**Auth:** User auth required.

**Response:** `204 No Content`

### Get Deck Color Identity

`GET /deck-color-identity`

Returns color identity for one or more decks by name.

---

## Leaderboard

### Get Leaderboard

`GET /leaderboard`

Returns deck win-rate leaderboard across all completed simulations.

**Response:**

```json
{
  "leaderboard": [
    {
      "deckId": "deck-uuid",
      "deckName": "Deck Name",
      "wins": 42,
      "losses": 58,
      "winRate": 0.42,
      "avgWinTurn": 9.5
    }
  ]
}
```

---

## Workers

### List Workers

`GET /workers`

Lists all active workers and current queue depth. Workers come from the
Realtime Database `presence/` entries seen in the last 3 minutes (5 while a
worker is updating). The web UI reads the same entries directly.
**Auth:** Firebase Auth required.

**Response:**

```json
{
  "workers": [
    {
      "workerId": "worker-1",
      "workerName": "MyWorker",
      "status": "busy",
      "capacity": 8,
      "activeSimulations": 4,
      "uptimeMs": 3600000,
      "lastHeartbeat": "2024-01-15T10:00:00.000Z",
      "ownerEmail": "admin@example.com"
    }
  ],
  "queueDepth": 5
}
```

### Get Worker Health

`GET /health/workers`

Returns a lightweight check on worker pool health (no auth required).

### Update Worker Config

`PATCH /workers/:id`

Updates per-worker configuration (e.g. concurrency override).
**Auth:** Firebase Auth required (must be owner or admin).

**Body:**

```json
{ "maxConcurrentOverride": 4 }
```

Pass `null` to clear the override.

**Response:**

```json
{ "ok": true, "maxConcurrentOverride": 4, "pushResult": "success" }
```

`pushResult` is one of `"success"`, `"failed"`, or `"no_url"`.

### Worker Heartbeat

`POST /workers/heartbeat`

Reports worker liveness and retrieves configuration overrides. Used by the
Docker worker about once a minute. The API writes the beat into the worker's
Realtime Database presence entry (`presence/{workerId}`) and writes the
Firestore `workers/{id}` doc (name, owner, push URL, version) only when those
fields change. The desktop worker writes its own presence entry directly and
does not call this endpoint.
**Auth:** Worker auth required.

**Body:**

```json
{
  "workerId": "worker-1",
  "workerName": "MyWorker",
  "status": "busy",
  "capacity": 8,
  "activeSimulations": 4,
  "uptimeMs": 3600000,
  "ownerEmail": "admin@example.com"
}
```

**Response:**

```json
{ "ok": true, "maxConcurrentOverride": null }
```

---

## Worker Setup

### Generate Setup Token

`POST /worker-setup/token`

Generates a time-limited token for bootstrapping a new worker.
**Auth:** Firebase Auth required.

**Response:**

```json
{
  "token": "base64-setup-token",
  "expiresIn": "24 hours",
  "apiUrl": "https://api.example.com",
  "scriptUrl": "https://raw.githubusercontent.com/..."
}
```

### Get Worker Config

`POST /worker-setup/config`

Returns AES-256-GCM encrypted worker config (secrets, API URL, worker secret).
**Auth:** `X-Setup-Token` header required.
**Headers:** `X-Encryption-Key` (64-char hex string).

**Response:**

```json
{
  "iv": "base64-iv",
  "ciphertext": "base64-ciphertext",
  "tag": "base64-auth-tag"
}
```

---

## Coverage (Internal / Admin)

These endpoints support the automated coverage-testing system that ensures all precon matchups are simulated.

### Get Coverage Config

`GET /coverage/config`

Returns coverage configuration (enabled, target matchups, etc.).
**Auth:** Admin access required.

### Get Next Coverage Job

`GET /coverage/next-job`

Returns the next uncovered matchup to simulate.
**Auth:** Admin access required.

### Get Coverage Status

`GET /coverage/status`

Returns overall coverage progress (% of matchups completed).
**Auth:** Admin access required.

---

## Access Requests

Each user who asks for access, or is given it, has one private record at `users/{uid}`: email, display name, `status` (`requested` or `allowed`), message, and request and approval times. Only the API reads it (`api/lib/user-store.ts`).

### Submit Access Request

`POST /access-requests`

Body: `{ displayName?, message? }`. Records the request and emails the admin an approve link. Answers 200 without a new email when the user already asked or already has access.
**Auth:** Firebase Auth required.

### Check Access Request

`GET /access-requests`

Returns `{ hasRequest, status }`, where `status` is `pending` or `approved` (or null with no request).
**Auth:** Firebase Auth required.

### Approve Access Request

`GET /access-requests/approve?token=...`

The link from the access-request email. The token is signed with `WORKER_SECRET` and expires after 24 hours. Marks the user's record allowed and returns an HTML page.

---

## User

### Get Current User

`GET /me`

Returns the signed-in user's access. Any signed-in user may call it; the web app uses it to decide what to show.
**Auth:** Firebase Auth required.

**Response:**

```json
{
  "uid": "user-uid",
  "email": "user@example.com",
  "isAdmin": false,
  "isAllowed": true,
  "hasRequestedAccess": false
}
```

### Moxfield Import Status

`GET /moxfield-status`

Returns whether the server-side Moxfield API import is currently enabled.

**Response:**

```json
{ "enabled": true }
```

---

## Admin

### Backfill Ratings

`POST /admin/backfill-ratings`

Applies per-deck win stats and pair game counts for the 200 most recent
completed jobs that haven't been rated yet (a rated job carries
`appliedStats.ratings`), reading their structured logs.
**Auth:** Admin access required.

### Broadcast Pull Image

`POST /admin/pull-image`

Broadcasts a `pull-image` command to all active workers so they update their Docker image.
**Auth:** Worker auth required.

**Response:**

```json
{ "ok": true, "message": "Pull-image broadcast sent" }
```

### Sweep Stale Jobs

`POST /admin/sweep-stale-jobs`

Marks jobs FAILED if they have been stuck in RUNNING/QUEUED beyond a timeout threshold.
**Auth:** Admin access required.

### Sync Precons

`POST /sync/precons`

Triggers a re-sync of the preconstructed deck library from the source data.
**Auth:** Admin access required.

---

## System

### Health Check

`GET /health`

Unauthenticated system health check. Evaluates stuck jobs, leaderboard ratings, and worker connectivity.

**Response:**

```json
{
  "status": "ok",
  "checks": {
    "stuckJobs": { "ok": true, "detail": "0 active job(s), none stuck" },
    "ratings": { "ok": true, "detail": "Leaderboard has entries" },
    "worker": { "ok": true, "detail": "1 active worker(s)" }
  }
}
```
