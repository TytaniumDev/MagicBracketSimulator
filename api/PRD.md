# Product Requirements Document: API Service

_Last updated: May 2025 — reflects the shipped system, not a future plan._

## 1. Overview

The **API Service** is the backend of the Magic Bracket Simulator. It handles:

- **Deck ingestion** from Moxfield, Archidekt, and ManaBox (URL import and manual text paste).
- **Job lifecycle management** — creating, queuing, tracking, and cancelling simulation jobs.
- **Worker coordination** — handing out simulation work, receiving results, and managing heartbeats.
- **Results storage and aggregation** — structured logs, win tallies, Elo-style ratings, and a leaderboard.
- **Auth and access control** — Firebase Authentication for user-facing and worker endpoints; a shared secret (`X-Worker-Secret`) for internal calls from Cloud Tasks and Cloud Scheduler.

---

## 2. Architecture

| Layer          | Technology                                                         |
| -------------- | ------------------------------------------------------------------ |
| Framework      | **Next.js 15 (App Router)** — serves both frontend and API routes |
| Database       | **SQLite** (local dev) · **Firestore** (GCP production)           |
| Storage        | **Local filesystem** (dev) · **Google Cloud Storage** (GCP prod)  |
| Auth           | **Firebase Authentication** (Google sign-in)                      |
| Worker auth    | The desktop worker's Firebase ID token (allowed users)            |
| Job dispatch   | **Claiming** (workers claim simulations via `GET /api/jobs/claim-sim`) |
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
| `parallelism`  | How many sims of this job may run at once                       |
| `gamesCompleted` | Running count of finished games                               |
| `retryCount`   | Number of times the job has been re-queued after a failure      |
| `errorMessage` | Set on `FAILED`                                                 |

### 3.2 Simulations

Each Job is divided into **Simulations** (sub-units of work). Each simulation is a fixed batch of games (currently `GAMES_PER_CONTAINER` = 25). Workers atomically claim one simulation at a time via `GET /api/jobs/claim-sim`.

| State     | Meaning                                 |
| --------- | --------------------------------------- |
| `PENDING` | Not yet started                         |
| `RUNNING` | Claimed by a worker                     |
| `COMPLETED` | Finished successfully                 |
| `FAILED`  | Worker reported an error                |
| `CANCELLED` | Parent job was cancelled              |

### 3.3 Workers

Workers are the desktop app (`worker_flutter/`, macOS and Windows), signed in as an allowed user. They:

1. Write their own presence entry to the Realtime Database about once a minute.
2. Claim available simulations (`GET /api/jobs/claim-sim?lease=1`) and extend each sim's lease while it runs.
3. Run Forge as a local Java process.
4. Upload results via `POST /api/jobs/:id/logs/simulation` and `PATCH /api/jobs/:id/simulations/:simId`; reporting a job's last sim triggers aggregation.

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
  → Workers claim sims through claim-sim
  → Each worker runs Forge locally, uploads logs
  → the last sim's PATCH triggers aggregation
  → Job marked COMPLETED / FAILED
```

### 4.3 Authentication Model

| Endpoint type      | Auth required                                  |
| ------------------ | ---------------------------------------------- |
| Read-only public   | None                                           |
| User writes        | Firebase Auth Bearer token                     |
| Worker             | Firebase Auth Bearer token (allowed user)      |
| Internal (Cloud Tasks, Scheduler) | `X-Worker-Secret` header        |
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
