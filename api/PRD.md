# Product Requirements Document: API Service

_Last updated: May 2025 — reflects the shipped system, not a future plan._

## 1. Overview

The **API Service** is the backend of the Magic Bracket Simulator. It handles:

- **Deck ingestion** from Moxfield, Archidekt, and ManaBox (URL import and manual text paste).
- **Job lifecycle management** — creating, queuing, tracking, and cancelling simulation jobs.
- **Worker coordination** — handing out simulation work, receiving results, and managing heartbeats.
- **Results storage and aggregation** — structured logs, win tallies, Elo-style ratings, and a leaderboard.
- **Auth and access control** — Firebase Authentication for user-facing endpoints; HMAC-signed Worker Secret for internal worker communication.

---

## 2. Architecture

| Layer          | Technology                                                         |
| -------------- | ------------------------------------------------------------------ |
| Framework      | **Next.js 15 (App Router)** — serves both frontend and API routes |
| Database       | **SQLite** (local dev) · **Firestore** (GCP production)           |
| Storage        | **Local filesystem** (dev) · **Google Cloud Storage** (GCP prod)  |
| Auth           | **Firebase Authentication** (Google sign-in)                      |
| Worker auth    | `X-Worker-Secret` HMAC-signed header                              |
| Job dispatch   | **Polling** (workers claim simulations via `POST /api/jobs/claim-sim`) |
| Concurrency    | Per-job parallelism — each job is split into `N` independent simulations claimed by workers |

---

## 3. Core Concepts

### 3.1 Jobs

A **Job** represents one bracket simulation request: 4 decks, N games, optionally split across multiple worker processes.

| Field          | Description                                                     |
| -------------- | --------------------------------------------------------------- |
| `id`           | UUID                                                            |
| `deckIds`      | Array of 4 deck IDs                                             |
| `simulations`  | Total number of games to simulate                               |
| `status`       | `QUEUED` → `RUNNING` → `COMPLETED` \| `FAILED` \| `CANCELLED`  |
| `parallelism`  | How many worker containers run in parallel for this job         |
| `gamesCompleted` | Running count of finished games                               |
| `retryCount`   | Number of times the job has been re-queued after a failure      |
| `errorMessage` | Set on `FAILED`                                                 |

### 3.2 Simulations

Each Job is divided into **Simulations** (sub-units of work). Each simulation is a fixed batch of games (currently `GAMES_PER_CONTAINER` = 25). Workers atomically claim one simulation at a time via `POST /api/jobs/claim-sim`.

| State     | Meaning                                 |
| --------- | --------------------------------------- |
| `PENDING` | Not yet started                         |
| `RUNNING` | Claimed by a worker                     |
| `COMPLETED` | Finished successfully                 |
| `FAILED`  | Worker reported an error                |
| `CANCELLED` | Parent job was cancelled              |

### 3.3 Workers

Workers are long-running Node.js processes that communicate with the API via HTTP. They:

1. Send a heartbeat (`POST /api/workers/heartbeat`) every 30s.
2. Poll for available simulations (`POST /api/jobs/claim-sim`).
3. Spawn a Docker container with the Forge simulation engine.
4. Upload results via `PATCH /api/jobs/:id/simulations/:simId` and `POST /api/jobs/:id/logs/simulation`.
5. Trigger aggregation when done (`POST /api/jobs/:id/aggregate-if-done`).

### 3.4 Decks

Decks are stored centrally and reused across jobs. They come in two forms:

- **Precons** — official Commander preconstructed decks, loaded from a static JSON file served via GCS.
- **Community decks** — user-submitted decks stored in the database.

Decks are stored in `.dck` format (MTGO deck list syntax), which the Forge engine reads directly.

---

## 4. Feature Specifications

### 4.1 Deck Ingestion

- **Moxfield** — direct API fetch when available, fallback to manual paste export (MTGO format).
- **Archidekt** — direct URL import via Archidekt API.
- **ManaBox** — direct URL import via ManaBox share link.
- **Text paste** — user can paste a raw MTGO deck list directly.

All `deckUrl` and `deckLink` values are validated as well-formed `http:` or `https:` URLs to prevent SSRF.

### 4.2 Job Lifecycle

```
POST /api/jobs
  → Job created with status QUEUED
  → Simulations initialized (N = ceil(simulations / GAMES_PER_CONTAINER))
  → Workers poll claim-sim and start claiming
  → Each worker runs Docker container, uploads logs
  → aggregate-if-done checks if all sims finished
  → Job marked COMPLETED / FAILED
```

### 4.3 Authentication Model

| Endpoint type      | Auth required                                  |
| ------------------ | ---------------------------------------------- |
| Read-only public   | None                                           |
| User writes        | Firebase Auth Bearer token                     |
| Worker internal    | `X-Worker-Secret` header                       |
| Admin              | Firebase Auth + admin flag in user record      |

### 4.4 Coverage Testing

An automated system tracks which precon × precon matchups have been simulated. Admins can query coverage status and the system can auto-schedule uncovered matchups.

---

## 5. API Surface

See [API.md](../API.md) for full endpoint documentation.

**Endpoint count:** 41 route handlers across Jobs, Simulations, Logs, Decks, Workers, Leaderboard, Coverage, Access Requests, and System endpoints.

---

## 6. Data Storage

### Local (SQLite)

All data stored in a local SQLite database at `api/data/database.db`.

### GCP (Firestore + GCS)

- **Firestore**: job documents with real-time updates (`onSnapshot`).
- **GCS**: raw game logs, condensed logs, structured logs, and precon deck JSON.

Environment is determined by the `GCP_MODE` env var (`true` = GCP, `false`/absent = local SQLite).

---

## 7. Deployment

| Environment | Method                                                |
| ----------- | ----------------------------------------------------- |
| Local dev   | `npm run dev` in `api/`                              |
| Production  | Google Cloud Run (auto-scaled), deployed via GitHub Actions |

See `AGENTS.md` for the full build and test workflow.
