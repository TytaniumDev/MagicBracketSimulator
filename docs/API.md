# Magic Bracket Simulator API Documentation

This document describes the REST API for the Magic Bracket Simulator.

**Base URL:** `/api`

## Authentication

Most endpoints require authentication via Firebase Auth.
- **Header:** `Authorization: Bearer <firebase-id-token>`
- **Worker Auth:** Internal worker communication uses `X-Worker-Secret` header.

## Jobs

### List Jobs
`GET /jobs`

Returns a list of recent jobs with summary information.

**Response:**
```json
{
  "jobs": [
    {
      "id": "job-id",
      "name": "Deck A vs Deck B vs Deck C vs Deck D",
      "deckNames": ["Deck A", "Deck B", "Deck C", "Deck D"],
      "status": "COMPLETED",
      "simulations": 100,
      "gamesCompleted": 100,
      "createdAt": "2023-10-27T10:00:00.000Z",
      "hasResult": true,
      "durationMs": 120000,
      "parallelism": 4,
      "resultJson": { ... }
    }
  ]
}
```

### Create Job
`POST /jobs`

Creates a new simulation job. Requires authentication.

**Body:**
```json
{
  "deckIds": ["id1", "id2", "id3", "id4"],
  "simulations": 100,
  "parallelism": 4,
  "idempotencyKey": "optional-uuid"
}
```

**Response:**
```json
{
  "id": "new-job-id",
  "deckNames": ["Deck A", "Deck B", "Deck C", "Deck D"]
}
```

### Get Job Details
`GET /jobs/:id`

Returns detailed information about a specific job.

**Response:**
```json
{
  "id": "job-id",
  "status": "RUNNING",
  "simulations": 100,
  "gamesCompleted": 50,
  "decks": [ ... ],
  "workerId": "worker-123",
  "workerName": "MyWorker",
  "errorMessage": null,
  "resultJson": null
}
```

### Stream Job Updates (SSE)
`GET /jobs/:id/stream`

Server-Sent Events stream for real-time job updates.

**Events:**
- `data`: Job status update (JSON)
- `event: simulations`: List of simulation statuses (JSON)

### Recover Job (Worker/Task)
`POST /jobs/:id/recover`

Triggered by Cloud Tasks to recover stalled jobs.
**Auth:** Worker secret required.

**Response:**
```json
{
  "status": "ok",
  "recovered": true,
  "stillActive": false
}
```

### Bulk Delete Jobs (Admin)
`POST /jobs/bulk-delete`

Deletes multiple jobs and their associated artifacts.
**Auth:** Admin access required.

**Body:**
```json
{
  "jobIds": ["job-1", "job-2"]
}
```

## Simulations

### List Simulations
`GET /jobs/:id/simulations`

Returns the status of all individual simulations for a job.

**Response:**
```json
{
  "simulations": [
    {
      "simId": "sim_000",
      "index": 0,
      "state": "COMPLETED",
      "workerId": "worker-1",
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
{
  "count": 25
}
```

### Update Simulation Status (Worker)
`PATCH /jobs/:id/simulations/:simId`

Updates the status of a single simulation.
**Auth:** Worker auth required.

**Body:**
```json
{
  "state": "COMPLETED", // PENDING, RUNNING, COMPLETED, FAILED, CANCELLED
  "workerId": "worker-1",
  "workerName": "MyWorker",
  "durationMs": 45000,
  "errorMessage": null,
  "winner": "Deck A",
  "winningTurn": 8
}
```

## Logs

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

### Get Condensed Logs
`GET /jobs/:id/logs/condensed`

Returns condensed statistical data for a completed job.

**Response:**
```json
{
  "condensed": { ... }
}
```

### Get Structured Logs
`GET /jobs/:id/logs/structured`

Returns parsed game events for visualization.

**Response:**
```json
[
  {
    "gameIndex": 0,
    "events": [ ... ]
  }
]
```

## Decks

### List Decks
`GET /decks`

Lists all decks.

**Response:**
```json
{
  "decks": [
    {
      "id": "deck-id",
      "name": "Deck Name",
      "primaryCommander": "Commander Name",
      "colorIdentity": ["W", "U"],
      "isPrecon": false,
      "link": "https://moxfield.com/..."
    }
  ]
}
```

### Create Deck
`POST /decks`

Creates a new deck from a URL (Moxfield, Archidekt, ManaBox) or raw text.
**Auth:** User auth required.

**Body:**
```json
{
  "deckUrl": "https://moxfield.com/..."
}
```

### Get Deck Color Identity
`GET /deck-color-identity`

Returns color identity for requested deck names.

**Query Params:**
- `names`: Comma-separated list of deck names.

**Response:**
```json
{
  "Deck Name": ["W", "U"],
  "Another Deck": ["R", "G"]
}
```

### Moxfield Status
`GET /moxfield-status`

Checks if Moxfield API direct import is enabled.

**Response:**
```json
{
  "enabled": true
}
```

## Workers

### List Workers
`GET /workers`

Lists active workers and queue depth.

**Response:**
```json
{
  "workers": [ ... ],
  "queueDepth": 0
}
```

### Worker Heartbeat (Worker)
`POST /workers/heartbeat`

Reports worker status and retrieves dynamic configuration overrides.
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

### Update Worker Config (Owner)
`PATCH /workers/:id`

Update worker configuration (e.g., max concurrent overrides).
**Auth:** Owner auth required.

**Body:**
```json
{
  "maxConcurrentOverride": 12
}
```

### Generate Setup Token (Allowed User)
`POST /worker-setup/token`

Generates a time-limited setup token for bootstrapping a remote worker.

**Response:**
```json
{
  "token": "...",
  "expiresIn": "24 hours",
  "scriptUrl": "..."
}
```

### Get Worker Config (Worker Setup)
`POST /worker-setup/config`

Retrieves encrypted worker configuration using a setup token.
**Header:** `X-Setup-Token: <token>`

**Response:**
AES-256-GCM encrypted JSON.

## System & Leaderboard

### Health Check
`GET /health`

Public system health check.

**Response:**
```json
{
  "status": "ok",
  "checks": {
    "stuckJobs": { "ok": true, "detail": "..." },
    "ratings": { "ok": true, "detail": "..." },
    "worker": { "ok": true, "detail": "..." }
  }
}
```

### Current User
`GET /me`

Returns current user info and admin status.

**Response:**
```json
{
  "email": "user@example.com",
  "uid": "...",
  "isAdmin": false
}
```

### Submit Access Request
`POST /access-requests`

Request access to run simulations (GCP mode).

**Body:**
```json
{
  "displayName": "User Name",
  "message": "Reason for access..."
}
```

### Check Access Request
`GET /access-requests`

Check status of pending access request.

**Response:**
```json
{
  "hasRequest": true,
  "status": "pending"
}
```

### Sync Precons (Worker)
`POST /sync/precons`

Triggers Archidekt precon synchronization.
**Auth:** Worker auth required.

### Leaderboard
`GET /leaderboard`

Returns TrueSkill ratings for decks.

**Query Params:**
- `minGames`: Minimum games played (default 0).
- `limit`: Max results (default 500).

**Response:**
```json
{
  "decks": [
    {
      "deckId": "...",
      "name": "...",
      "rating": 25.5,
      "winRate": 0.55
    }
  ]
}
```
