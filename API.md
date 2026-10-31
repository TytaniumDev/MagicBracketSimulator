# Magic Bracket Simulator API Documentation

This document describes the REST API for the Magic Bracket Simulator.

**Base URL:** `/api`

**Authentication:**

- Public endpoints require no auth.
- User endpoints require Firebase Auth: `Authorization: Bearer <firebase-id-token>`
- Worker endpoints take the desktop worker's Firebase ID token like user endpoints: `Authorization: Bearer <firebase-id-token>` from an allowed user.
- Internal endpoints (called by Cloud Tasks and Cloud Scheduler) require the `X-Worker-Secret: <secret>` header.
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
      "seats": [
        { "deckId": "id1", "name": "Deck A", "link": "https://...", "colorIdentity": ["W", "U"] },
        { "deckId": "id2", "name": "Deck B", "link": null, "colorIdentity": ["B"] },
        { "deckId": "id3", "name": "Deck C", "link": null, "colorIdentity": ["R", "G"] },
        { "deckId": "id4", "name": "Deck D", "link": null, "colorIdentity": [] }
      ],
      "status": "COMPLETED",
      "simulations": 100,
      "gamesCompleted": 100,
      "createdAt": "2024-01-15T10:00:00.000Z",
      "durationMs": 120000,
      "parallelism": 4,
      "startedAt": "2024-01-15T10:00:01.000Z",
      "completedAt": "2024-01-15T10:02:01.000Z"
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

`simulations` is the number of games, from 4 to 1000.

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

`?view=worker` adds `decks: [{ name, dck }]` (the 4 decks with their .dck
content); the desktop worker asks for it to run the job's sims. `decks` is left out when a deck can no longer be found.

`results` is null until the job has results. Its `seats` line up with the
job's `seats` by position (the same deck can sit in two seats), and wins
are mapped from Forge's winner names to seats at aggregation.

**Response:**

```json
{
  "id": "job-uuid",
  "status": "RUNNING",
  "simulations": 100,
  "gamesCompleted": 50,
    "seats": [
      { "deckId": "id1", "name": "Deck A", "link": "https://...", "colorIdentity": ["W", "U"] },
      { "deckId": "id2", "name": "Deck B", "link": null, "colorIdentity": ["B"] },
      { "deckId": "id3", "name": "Deck C", "link": null, "colorIdentity": ["R", "G"] },
      { "deckId": "id4", "name": "Deck D", "link": null, "colorIdentity": [] }
    ],
  "results": {
    "gamesPlayed": 48,
    "seats": [
      { "wins": 20, "avgWinTurn": 8.4 },
      { "wins": 12, "avgWinTurn": 9.1 },
      { "wins": 10, "avgWinTurn": 10.0 },
      { "wins": 6, "avgWinTurn": 9.5 }
    ]
  },
  "errorMessage": null,
  "retryCount": 0,
  "queuePosition": 0,
  "workers": { "online": 2, "idle": 1, "busy": 1 },
  "createdAt": "2024-01-15T10:00:00.000Z",
  "startedAt": "2024-01-15T10:00:01.000Z",
  "completedAt": null,
  "durationMs": null
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
**Auth:** Internal (`X-Worker-Secret`).

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
**Auth:** Allowed user's Firebase ID token (the desktop worker).

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

### Update Simulation Status (Worker)

`PATCH /jobs/:id/simulations/:simId`

Updates the status of a single simulation.

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
**Auth:** Allowed user's Firebase ID token (the desktop worker).

### Extend Simulation Lease (Worker)

`POST /jobs/:id/simulations/:simId/lease`

Pushes a running sim's lease back 3 minutes. Workers call it about once a minute.
**Auth:** Allowed user's Firebase ID token (the desktop worker).

**Body:**

```json
{ "workerId": "worker-1" }
```

**Response:** `{ "status": "extended" | "cancelled" | "lost" }`. On `cancelled`
the job was cancelled; on `lost` the sim is no longer this worker's. Either
way the worker stops the sim, and on `lost` it reports nothing.

---

## Logs

### Upload Simulation Log (Worker)

`POST /jobs/:id/logs/simulation`

Uploads the raw log for a completed simulation.
**Auth:** Allowed user's Firebase ID token (the desktop worker).

**Body:**

```json
{
  "filename": "raw/game_001.txt",
  "logText": "..."
}
```

### List Games

`GET /jobs/:id/logs/games`

Returns every game of a finished job in play order, with its winner:
`{ deckNames?, games: [{ winner?, winningTurn? }] }`. 404 when the job has no logs.

### Get One Game's Logs

`GET /jobs/:id/logs/games/:n`

Returns game `n` (counted from 0): `{ raw, condensed, structured }` — the raw Forge log,
the condensed AI-input summary, and the parsed deck × turn actions. Built from the raw log
on each request. 404 past the last game.

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
Realtime Database `presence/` entries seen in the last 3 minutes (none in
local mode). The web UI reads the same entries directly.
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
      "lastHeartbeat": "2024-01-15T10:00:00.000Z"
    }
  ],
  "queueDepth": 5
}
```

### Get Worker Health

`GET /health/workers`

Returns a lightweight check on worker pool health (no auth required).

---

## Coverage (Internal / Admin)

These endpoints support the automated coverage-testing system that ensures all precon matchups are simulated.

### Get Coverage Config

`GET /coverage/config`

Returns coverage configuration (enabled, target matchups, etc.).
**Auth:** Admin access required.

### Request Next Coverage Job

`POST /coverage/next-job`

Creates a job for the next under-covered precon pod, if coverage is enabled
and no coverage job is active. An idle worker calls it.
**Auth:** Allowed user's Firebase ID token (the desktop worker).

**Response:** `201` `{ "id", "deckNames", "source": "coverage" }`, or
`200` `{ "reason" }` when there's nothing to create (`disabled`,
`active-job-exists`, `all-pairs-covered`, `deck-resolution-failed`).

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

### Sweep Stale Jobs

`POST /admin/sweep-stale-jobs`

Marks jobs FAILED if they have been stuck in RUNNING/QUEUED beyond a timeout threshold.
**Auth:** Internal (`X-Worker-Secret`; Cloud Scheduler).

### Sync Precons

`POST /sync/precons`

Triggers a re-sync of the preconstructed deck library from the source data.
**Auth:** Internal (`X-Worker-Secret`; Cloud Scheduler).

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
