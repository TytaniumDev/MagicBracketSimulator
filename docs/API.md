# Magic Bracket Simulator API Documentation

This document describes the REST API for the Magic Bracket Simulator.

**Base URL:** `/api`
**Authentication:**
- Most endpoints are public or use Firebase Auth (Bearer Token).
- Worker endpoints use `X-Worker-Secret` header or `Authorization: Bearer <token>` if configured.

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

Creates a new simulation job. Requires authentication (Firebase Auth).

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

### Get Next Job (Worker)
`GET /jobs/next`

Used by the worker in polling mode to claim the next QUEUED job.
**Auth:** `X-Worker-Secret` header required.

**Response:**
- `200 OK`: Job object (same as `GET /jobs/:id`)
- `204 No Content`: No jobs available

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

## Workers

### Worker Heartbeat
`POST /workers/heartbeat`

Reports worker status and retrieves dynamic configuration overrides.
**Auth:** Worker auth required.

**Body:**
```json
{
  "workerId": "worker-1",
  "workerName": "MyWorker",
  "status": "busy", // idle, busy, updating
  "capacity": 8,
  "activeSimulations": 4,
  "uptimeMs": 3600000,
  "ownerEmail": "admin@example.com"
}
```

**Response:**
```json
{
  "ok": true,
  "maxConcurrentOverride": 4 // Optional override from admin
}
```

## Decks

### List Decks
`GET /decks`

Lists all decks (precons and user submissions).

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
OR
```json
{
  "deckText": "1 Sol Ring\n1 Command Tower...",
  "deckName": "My Custom Deck",
  "deckLink": "Optional Link"
}
```

### List Precons
`GET /precons`

Legacy endpoint to list precon decks. Use `GET /decks` with client-side filtering instead.
