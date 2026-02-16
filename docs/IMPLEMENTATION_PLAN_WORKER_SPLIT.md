# Implementation Plan: Worker + Simulation Split Architecture

> **Status:** 🟢 In Progress — Phases 1, 2, 3, 4, 5, 6 Complete (except smoke test)
> **Author:** Antigravity  
> **Created:** 2026-02-15  
> **Last Updated:** 2026-02-15  
> **Related:** `docs/ARCHITECTURE.md`, `.gemini/antigravity/brain/*/worker_containerization_analysis.md`

---

## 🔖 Current Status / Resume Context

> **If resuming from a previous session, read this section first.**

**Where we are:** **Phases 1–6 are complete** (except final end-to-end smoke test). All implementation, CI/CD, and documentation work is done.

**What was done:**
1. Analyzed the entire current architecture (worker, API, frontend, CI/CD, infrastructure)
2. Compared 1×10 vs 10×1 simulation strategies → 10×1 is unambiguously better
3. Designed the Worker + Simulation split architecture
4. Wrote this detailed implementation plan with all phases
5. ✅ Implemented Phase 1: data model, Firestore + SQLite CRUD, API endpoints, SSE stream enhancements
6. ✅ Implemented Phase 2: simulation Dockerfile, docker-compose build helper
7. ✅ Implemented Phase 3: worker refactor — container orchestration mode with backward-compatible monolithic fallback
8. ✅ Implemented Phase 4: frontend types, useJobStream hook enhancement, SimulationGrid component
9. ✅ Implemented Phase 5: CI/CD already had both image builds; updated setup-worker.sh to pull simulation image; documented Watchtower simulation image update flow
10. ✅ Implemented Phase 6: updated ARCHITECTURE.md with full two-image architecture docs; updated CLAUDE.md with new build commands and patterns; legacy code retained for backward compat

**What to do next:** End-to-end smoke test (Phase 6.5) and browser verification of real-time simulation updates (Phase 4.5).

**Key files changed:**
- `api/lib/types.ts` — Added `SimulationState`, `SimulationStatus` types
- `api/lib/db.ts` — Added `simulations` SQLite table
- `api/lib/job-store.ts` — Added simulation CRUD (SQLite)
- `api/lib/firestore-job-store.ts` — Added simulation subcollection CRUD (Firestore)
- `api/lib/job-store-factory.ts` — Added simulation factory delegations + `deriveJobStatus()`
- `api/app/api/jobs/[id]/simulations/route.ts` — **NEW** GET + POST endpoint
- `api/app/api/jobs/[id]/simulations/[simId]/route.ts` — **NEW** PATCH endpoint
- `api/app/api/jobs/[id]/stream/route.ts` — Enhanced SSE with simulation events
- `simulation/Dockerfile` — **NEW** standalone simulation image (Java+Forge+xvfb)
- `simulation/docker-compose.yml` — **NEW** build helper
- `worker/Dockerfile` — Slimmed to Node.js + Docker CLI only
- `worker/docker-compose.yml` — Docker socket mount, SIMULATION_IMAGE env, reduced memory
- `worker/src/worker.ts` — Full refactor: Semaphore, container orchestration, per-sim reporting, backward compat
- `frontend/src/types/simulation.ts` — **NEW** frontend simulation types
- `frontend/src/hooks/useJobStream.ts` — Added `simulations` state + SSE listener
- `frontend/src/components/SimulationGrid.tsx` — **NEW** visual grid component
- `frontend/src/pages/JobStatus.tsx` — Integrated SimulationGrid

---

## ✅ Progress Tracker

### Phase 1 — Data Model & API (~3-4 hours)
- [x] **1.1** Add `SimulationState` and `SimulationStatus` types to `api/lib/types.ts`
- [x] **1.2** Add Firestore simulations subcollection CRUD to `api/lib/firestore-job-store.ts`
  - [x] `initializeSimulations(jobId, count)`
  - [x] `updateSimulationStatus(jobId, simId, update)`
  - [x] `getSimulationStatuses(jobId)`
- [x] **1.3** Add `simulations` SQLite table to `api/lib/db.ts`
- [x] **1.4** Add simulation CRUD to `api/lib/job-store.ts` (SQLite impl)
- [x] **1.5** Add delegating functions to `api/lib/job-store-factory.ts`
- [x] **1.6** Create `api/app/api/jobs/[id]/simulations/route.ts` (GET + POST)
- [x] **1.7** Create `api/app/api/jobs/[id]/simulations/[simId]/route.ts` (PATCH)
- [x] **1.8** Enhance SSE stream in `api/app/api/jobs/[id]/stream/route.ts`
- [x] **1.9** Add `deriveJobStatus()` utility
- [x] **1.10** Build verified — API and frontend compile cleanly, existing tests pass

### Phase 2 — Simulation Docker Image (~1-2 hours)
- [x] **2.1** Create `simulation/Dockerfile`
- [x] **2.2** References `worker/forge-engine/` via repo-root build context (no copy needed)
- [x] **2.3** `run_sim.sh` already supports `--simulations 1` — no changes needed
- [x] **2.4** `simulation/docker-compose.yml` created for build helper
- [x] **2.5** Precon decks bundled via `COPY worker/forge-engine/precons/`

### Phase 3 — Worker Refactor (~4-6 hours)
- [x] **3.1** Slim down `worker/Dockerfile` (remove Java/Forge, add Docker CLI)
- [x] **3.2** Update `worker/docker-compose.yml` (Docker socket mount, reduced memory)
- [x] **3.3** Add `Semaphore` class to worker
- [x] **3.4** Replace `runForgeSim()` with `runSimulationContainer()` (kept monolithic as fallback)
- [x] **3.5** Replace `processJob()` with resource-aware scheduler (`processJobWithContainers`)
- [x] **3.6** Add `reportSimulationStatus()` and `apiInitializeSimulations()` API calls
- [x] **3.7** Update Pub/Sub `flowControl.maxMessages` (1 → capacity in container mode)
- [x] **3.8** Remove `isProcessingJob` mutex (isolated containers handle concurrency)
- [x] **3.9** Add `ensureSimulationImage()` pre-pull on startup
- [x] **3.10** Build verified — worker, API, frontend all compile cleanly

### Phase 4 — Frontend: Incremental Progress (~2-3 hours)
- [x] **4.1** Add `SimulationState` and `SimulationStatus` types to frontend
- [x] **4.2** Update `useJobStream` hook to handle `simulations` SSE event
- [x] **4.3** Create `SimulationGrid` component
- [x] **4.4** Integrate `SimulationGrid` into `JobStatus.tsx`
- [ ] **4.5** Test: verify real-time updates in browser

### Phase 5 — CI/CD & Infrastructure (~1-2 hours)
- [x] **5.1** Add simulation image build job to `.github/workflows/deploy-worker.yml`
- [x] **5.2** Update Watchtower config to document simulation image update flow
- [x] **5.3** Update `scripts/setup-worker.sh` to pull simulation image
- [x] **5.4** Add `SIMULATION_IMAGE` to Secret Manager config (already in `worker-host-config`)
- [x] **5.5** Update `.github/workflows/provision-worker.yml` (already includes `SIMULATION_IMAGE`)

### Phase 6 — Cleanup & Documentation (~1-2 hours)
- [x] **6.1** Remove deprecated code — _deferred: legacy monolithic mode retained for backward compat_
- [x] **6.2** Move `worker/forge-engine/` — _deferred: simulation Dockerfile references `worker/forge-engine/` via repo-root build context, works as-is_
- [x] **6.3** Update `docs/ARCHITECTURE.md` with new diagrams
- [x] **6.4** Update `CLAUDE.md` with new build/dev instructions
- [ ] **6.5** Final end-to-end smoke test

---

## 📝 Session Log

| Date | Session | Work Done |
|------|---------|-----------|
| 2026-02-15 | Initial analysis | Analyzed full codebase. Compared 1×10 vs 10×1. Wrote architecture analysis doc. Wrote this implementation plan. No code changes. |
| 2026-02-15 | Phase 1 + 4 | Implemented all of Phase 1 (types, SQLite, Firestore, API endpoints, SSE stream) and Phase 4 (frontend types, useJobStream, SimulationGrid, JobStatus integration). All builds clean, tests pass. |
| 2026-02-15 | Phase 2 + 3 | Created simulation Dockerfile + docker-compose. Full worker refactor: slimmed Dockerfile, container orchestration mode with Semaphore-bounded concurrency, per-sim status reporting, monolithic backward-compat. All services compile cleanly. |
| 2026-02-15 | Phase 5 + 6 | CI/CD: setup-worker.sh pulls simulation image, Watchtower docs updated (5.1-5.5 already done by prior sessions). Docs: rewrote ARCHITECTURE.md with two-image architecture, updated CLAUDE.md with new patterns/commands. Legacy code retained for backward compat. |
| | _Next session_ | _End-to-end smoke test (6.5) and browser verification of real-time simulation updates (4.5)._ |

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Overview (Before → After)](#2-architecture-overview)
3. [Phase 1 — Data Model & API: Per-Simulation Tracking](#phase-1--data-model--api-per-simulation-tracking)
4. [Phase 2 — Simulation Docker Image](#phase-2--simulation-docker-image)
5. [Phase 3 — Worker Refactor](#phase-3--worker-refactor)
6. [Phase 4 — Frontend: Incremental Progress](#phase-4--frontend-incremental-progress)
7. [Phase 5 — CI/CD & Infrastructure](#phase-5--cicd--infrastructure)
8. [Phase 6 — Cleanup & Documentation](#phase-6--cleanup--documentation)
9. [Migration Strategy](#migration-strategy)
10. [Risk Register](#risk-register)

---

## 1. Executive Summary

Split the current monolithic worker Docker image into two images:

| Image | Contents | Role |
|-------|----------|------|
| **`worker`** | Node.js 20 only (~50MB) | Pub/Sub subscriber, resource monitor, simulation orchestrator, result aggregator |
| **`simulation`** | Java 17 + Forge + xvfb (~750MB) | Runs exactly 1 simulation (1 game), writes log, exits |

**Key benefits:**
- Per-simulation progress visible in real-time on the frontend
- Failure isolation — 1 crashed simulation ≠ entire job lost
- Resource-aware auto-scaling — worker fills available CPU/RAM dynamically
- Multi-machine scaling — add a machine, run `setup-worker.sh`, done

**Non-goals for v1:**
- Per-simulation Pub/Sub messages (the API still publishes one `job-created` message; the *worker* decomposes into individual simulation containers)
- Kubernetes/container orchestration — we stay on Docker Compose + host Docker socket
- Changing the Forge simulation engine itself

---

## 2. Architecture Overview

### Before (Current)

```
Pub/Sub ──→ Worker Container (Node.js + Java + xvfb)
                │
                ├─ child_process.spawn(forge, ["-n", "10"])  ← sequential inside JVM
                ├─ child_process.spawn(forge, ["-n", "10"])
                └─ ... (parallel batches, but sims within each are serial)
                │
                └──→ POST /api/jobs/:id/logs
```

- `flowControl.maxMessages: 1` — one job at a time
- No per-simulation status
- Shared deck filesystem prevents concurrent jobs

### After (Proposed)

```
Pub/Sub ──→ Worker Container (Node.js only)
                │
                ├─ docker run simulation --game 1  ← true parallel, 1 game each
                ├─ docker run simulation --game 2
                ├─ docker run simulation --game N
                │   (up to capacity based on CPU/RAM)
                │
                ├──→ PATCH /api/jobs/:id  (per-simulation progress)
                └──→ POST /api/jobs/:id/logs  (aggregated logs)
```

- `flowControl.maxMessages: <capacity>` — fill available resources
- Per-simulation status tracked in Firestore subcollection
- Each simulation container has isolated deck directory
- Worker mounts `/var/run/docker.sock` to manage simulation lifecycle

---

## Phase 1 — Data Model & API: Per-Simulation Tracking

> **Goal:** Add the data structures and API endpoints needed to track individual simulation status within a job, *before* changing the worker or frontend.

### 1.1 New Type: `SimulationStatus`

**File:** `api/lib/types.ts`

```typescript
// Add after existing JobStatus type

export type SimulationState = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export interface SimulationStatus {
  /** Unique ID for this simulation within the job (e.g., "sim_001") */
  simId: string;
  /** 0-based index within the job */
  index: number;
  /** Current state */
  state: SimulationState;
  /** Which worker is running this simulation */
  workerId?: string;
  /** When the simulation started */
  startedAt?: string;
  /** When the simulation finished */
  completedAt?: string;
  /** Duration in ms */
  durationMs?: number;
  /** Error message if FAILED */
  errorMessage?: string;
  /** Winner of this game (if completed) */
  winner?: string;
  /** Turn the game ended on */
  winningTurn?: number;
}
```

### 1.2 Firestore: Simulations Subcollection

**File:** `api/lib/firestore-job-store.ts`

Add a subcollection `jobs/{jobId}/simulations/{simId}` to store per-simulation documents.

**New functions to add:**

```typescript
// Initialize simulation status docs when job starts processing
export async function initializeSimulations(
  jobId: string,
  count: number
): Promise<void>

// Update a single simulation's state
export async function updateSimulationStatus(
  jobId: string,
  simId: string,
  update: Partial<SimulationStatus>
): Promise<void>

// Get all simulation statuses for a job
export async function getSimulationStatuses(
  jobId: string
): Promise<SimulationStatus[]>
```

**Key design decisions:**
- Use a **subcollection** (not an array field) so Firestore `onSnapshot` listeners can watch individual simulation changes without re-transmitting the entire job document.
- Simulation IDs: `sim_000`, `sim_001`, ..., `sim_NNN` (zero-padded for sort order).
- The parent job document still has `gamesCompleted` (incremented atomically) for backward compatibility with the existing progress bar.

### 1.3 SQLite: Simulations Table (Local Mode)

**File:** `api/lib/db.ts`

```sql
CREATE TABLE IF NOT EXISTS simulations (
  sim_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'PENDING',
  worker_id TEXT,
  started_at TEXT,
  completed_at TEXT,
  duration_ms INTEGER,
  error_message TEXT,
  winner TEXT,
  winning_turn INTEGER,
  PRIMARY KEY (job_id, sim_id),
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);
```

### 1.4 Job Store Factory: New Methods

**File:** `api/lib/job-store-factory.ts`

Add delegating functions:

```typescript
export async function initializeSimulations(jobId: string, count: number): Promise<void>
export async function updateSimulationStatus(jobId: string, simId: string, update: Partial<SimulationStatus>): Promise<void>
export async function getSimulationStatuses(jobId: string): Promise<SimulationStatus[]>
```

### 1.5 API Endpoint: GET /api/jobs/[id]/simulations

**New file:** `api/app/api/jobs/[id]/simulations/route.ts`

Returns the list of `SimulationStatus[]` for a job. Used by the frontend to render per-simulation progress.

```typescript
// GET /api/jobs/:id/simulations
// Response: { simulations: SimulationStatus[] }
```

### 1.6 API Endpoint: PATCH /api/jobs/[id]/simulations/[simId]

**New file:** `api/app/api/jobs/[id]/simulations/[simId]/route.ts`

Called by the worker to update individual simulation state.

```typescript
// PATCH /api/jobs/:id/simulations/:simId
// Body: { state: "RUNNING" | "COMPLETED" | "FAILED", ... }
// Auth: Worker secret
```

### 1.7 SSE Stream Enhancement

**File:** `api/app/api/jobs/[id]/stream/route.ts`

Enhance the existing SSE endpoint to include simulation statuses:

- **GCP mode:** Add a second Firestore `onSnapshot` listener on the `simulations` subcollection. When any simulation changes, emit a new SSE event:
  ```
  event: simulations
  data: {"simulations": [...]}
  ```
- **Local mode:** Include simulation statuses in the polling response.

The existing `event: job` messages continue unchanged for backward compatibility.

### 1.8 Job Status Derivation

Add logic to derive the overall job state from simulation states:

| Simulation States | Job Status |
|-------------------|------------|
| All PENDING | QUEUED |
| Any RUNNING | RUNNING |
| All COMPLETED | → trigger log aggregation → ANALYZING → COMPLETED |
| Any FAILED + rest done | COMPLETED (with partial results) or FAILED (configurable) |

**File:** `api/lib/firestore-job-store.ts` — add `deriveJobStatus()` utility.

---

## Phase 2 — Simulation Docker Image

> **Goal:** Extract the Forge/Java/xvfb layers into a standalone image that runs exactly one simulation.

### 2.1 New Dockerfile

**New file:** `simulation/Dockerfile`

```dockerfile
# ─── Simulation Image ───
# Runs exactly 1 Forge simulation (1 game), writes log, exits.

FROM eclipse-temurin:17-jre-jammy

# Install xvfb and dependencies (same as current worker Dockerfile)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      xvfb \
      libxrender1 \
      libxtst6 \
      libxi6 \
      libgl1-mesa-glx \
      libgtk-3-0 \
      fontconfig \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd -m -s /bin/bash simulator
USER simulator
WORKDIR /home/simulator

# Copy Forge engine
COPY --chown=simulator:simulator forge-engine/ /app/

# Set permissions
RUN chmod +x /app/run_sim.sh /app/forge.sh

# Environment
ENV FORGE_DIR=/home/simulator/.forge
ENV DISPLAY=:99

# The entrypoint runs a single simulation
# Expected args: --deck1 <path> --deck2 <path> --deck3 <path> --deck4 <path> --id <simId>
ENTRYPOINT ["/app/run_sim.sh"]
```

### 2.2 Modify `run_sim.sh` for Single-Game Mode

**File:** `worker/forge-engine/run_sim.sh` → **Copy to** `simulation/forge-engine/run_sim.sh`

Add a `--single` flag or default `--simulations 1`:
- When invoked by the new workflow, always run with `-n 1` (one game)
- Each simulation container writes its log to a mounted volume with a unique filename
- Exit code 0 = success, non-zero = failure

### 2.3 Deck Passing Strategy

Instead of a shared filesystem, each simulation container gets:
- A **read-only volume mount** with the 4 deck `.dck` files
- The worker prepares deck files in a temp directory per-job, mounts it into all simulation containers for that job

```bash
docker run --rm \
  -v /tmp/jobs/<jobId>/decks:/app/decks:ro \
  -v /tmp/jobs/<jobId>/logs:/app/logs \
  --memory=600m \
  --cpus=1 \
  simulation:latest \
  --deck1 /app/decks/deck1.dck \
  --deck2 /app/decks/deck2.dck \
  --deck3 /app/decks/deck3.dck \
  --deck4 /app/decks/deck4.dck \
  --id sim_000 \
  --simulations 1
```

### 2.4 Precon Decks

Currently precons live inside the worker image at `worker/forge-engine/precons/`. For the simulation image:

- **Option A (recommended):** Bundle precons into the simulation image. The worker resolves deck IDs to names before launching containers, and the simulation container copies the appropriate precon `.dck` files from its built-in precons directory. This avoids the worker needing to know about precon file contents.
- **Option B:** Worker downloads precon `.dck` files from the API and includes them in the deck volume mount.

**Recommendation:** Option A for simplicity. The simulation image already has the precons, and adding ~2MB of `.dck` files to the image is negligible.

---

## Phase 3 — Worker Refactor

> **Goal:** Transform the worker from a monolithic Forge runner into a slim orchestrator that manages simulation containers.

### 3.1 Slim Down Worker Dockerfile

**File:** `worker/Dockerfile`

Remove all Java, Forge, and xvfb layers. The new worker Dockerfile:

```dockerfile
# ─── Worker Image (Orchestrator) ───

FROM node:20-slim

# Install Docker CLI (to manage simulation containers via host socket)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      docker.io \
      curl \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user (must be in docker group to use socket)
RUN useradd -m -s /bin/bash -G docker worker
USER worker
WORKDIR /home/worker/app

# Copy built worker
COPY --chown=worker:worker dist/ ./dist/
COPY --chown=worker:worker package*.json ./
RUN npm ci --omit=dev

ENTRYPOINT ["node", "dist/worker.js"]
```

**Size reduction:** ~800MB → ~100MB

### 3.2 Docker Compose Changes

**File:** `worker/docker-compose.yml`

```yaml
services:
  worker:
    image: ${IMAGE_NAME:-ghcr.io/tytaniumdev/magicbracketsimulator/worker}:latest
    restart: unless-stopped
    volumes:
      # Mount Docker socket so worker can manage simulation containers
      - /var/run/docker.sock:/var/run/docker.sock
      # Shared temp directory for deck/log files
      - /tmp/mbs-jobs:/tmp/mbs-jobs
      # GCP credentials
      - ${HOME}/.config/gcloud:/home/worker/.config/gcloud:ro
    environment:
      - GOOGLE_CLOUD_PROJECT=${GOOGLE_CLOUD_PROJECT}
      - SIMULATION_IMAGE=${SIMULATION_IMAGE:-ghcr.io/tytaniumdev/magicbracketsimulator/simulation}:latest
      - NODE_ENV=production
    deploy:
      resources:
        limits:
          memory: 512M  # Worker itself is lightweight now
```

### 3.3 Worker Core Logic Refactor

**File:** `worker/src/worker.ts`

#### 3.3.1 New Configuration

```typescript
const SIMULATION_IMAGE = process.env.SIMULATION_IMAGE || 'simulation:latest';
const JOBS_DIR = process.env.JOBS_DIR || '/tmp/mbs-jobs';

// Resource constants (same as current, but used for container scheduling)
const RAM_PER_SIM_MB = 600;
const SYSTEM_RESERVE_MB = 2048;
const CPU_PER_SIM = 1;
const CPU_RESERVE = 2;
```

#### 3.3.2 Replace `runForgeSim()` with `runSimulationContainer()`

```typescript
interface SimulationResult {
  simId: string;
  exitCode: number;
  logFile: string;
  durationMs: number;
  error?: string;
}

async function runSimulationContainer(
  jobId: string,
  simId: string,
  deckDir: string,
  logDir: string
): Promise<SimulationResult> {
  const startTime = Date.now();
  const containerName = `sim-${jobId}-${simId}`;

  // Report RUNNING to API
  await reportSimulationStatus(jobId, simId, { state: 'RUNNING' });

  const args = [
    'run', '--rm',
    '--name', containerName,
    '--memory', `${RAM_PER_SIM_MB}m`,
    '--cpus', String(CPU_PER_SIM),
    '-v', `${deckDir}:/app/decks:ro`,
    '-v', `${logDir}:/app/logs`,
    SIMULATION_IMAGE,
    '--id', simId,
    '--simulations', '1',
  ];

  // Add deck arguments
  // (deck filenames are standardized: deck_0.dck, deck_1.dck, etc.)
  const deckFiles = fs.readdirSync(deckDir).filter(f => f.endsWith('.dck')).sort();
  for (const dck of deckFiles) {
    args.push('--deck', `/app/decks/${dck}`);
  }

  const result = await runProcess('docker', args, { timeout: 24 * 60 * 60 * 1000 });

  const durationMs = Date.now() - startTime;
  const logFile = path.join(logDir, `${simId}_game_1.txt`);

  if (result.exitCode !== 0) {
    await reportSimulationStatus(jobId, simId, {
      state: 'FAILED',
      durationMs,
      errorMessage: result.stderr || `Exit code ${result.exitCode}`,
    });
    return { simId, exitCode: result.exitCode, logFile, durationMs, error: result.stderr };
  }

  await reportSimulationStatus(jobId, simId, {
    state: 'COMPLETED',
    durationMs,
  });

  return { simId, exitCode: 0, logFile, durationMs };
}
```

#### 3.3.3 Replace `processJob()` with Resource-Aware Scheduler

The new `processJob()` implements a **semaphore-based scheduler** that fills available capacity:

```typescript
async function processJob(jobData: JobData): Promise<void> {
  const jobId = jobData.jobId;
  const totalSims = jobData.simulations;
  const capacity = calculateDynamicParallelism(totalSims);

  // 1. Prepare deck files
  const deckDir = path.join(JOBS_DIR, jobId, 'decks');
  const logDir = path.join(JOBS_DIR, jobId, 'logs');
  fs.mkdirSync(deckDir, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });

  await writeDeckFiles(jobData.decks, deckDir);

  // 2. Initialize simulation tracking in API
  await initializeSimulations(jobId, totalSims);

  // 3. Run simulations with bounded concurrency
  const simIds = Array.from({ length: totalSims }, (_, i) =>
    `sim_${String(i).padStart(3, '0')}`
  );

  const results: SimulationResult[] = [];
  const semaphore = new Semaphore(capacity);

  await Promise.all(
    simIds.map(async (simId) => {
      await semaphore.acquire();
      try {
        const result = await runSimulationContainer(jobId, simId, deckDir, logDir);
        results.push(result);

        // Update job-level progress
        const completed = results.filter(r => r.exitCode === 0).length;
        await updateJobProgress(jobId, completed);
      } finally {
        semaphore.release();
      }
    })
  );

  // 4. Aggregate logs and POST to API
  const gameLogs = results
    .filter(r => r.exitCode === 0 && fs.existsSync(r.logFile))
    .map(r => fs.readFileSync(r.logFile, 'utf-8'));

  if (gameLogs.length > 0) {
    await postLogs(jobId, gameLogs, jobData.deckNames, jobData.deckLists);
  }

  // 5. Clean up temp files
  fs.rmSync(path.join(JOBS_DIR, jobId), { recursive: true, force: true });
}
```

#### 3.3.4 Simple Semaphore Implementation

```typescript
class Semaphore {
  private count: number;
  private waiting: (() => void)[] = [];

  constructor(max: number) {
    this.count = max;
  }

  async acquire(): Promise<void> {
    if (this.count > 0) {
      this.count--;
      return;
    }
    return new Promise<void>(resolve => this.waiting.push(resolve));
  }

  release(): void {
    if (this.waiting.length > 0) {
      const next = this.waiting.shift()!;
      next();
    } else {
      this.count++;
    }
  }
}
```

#### 3.3.5 API Communication Functions

```typescript
async function reportSimulationStatus(
  jobId: string,
  simId: string,
  update: Partial<SimulationStatus>
): Promise<void> {
  await fetch(`${API_URL}/api/jobs/${jobId}/simulations/${simId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'x-worker-secret': WORKER_SECRET,
    },
    body: JSON.stringify(update),
  });
}

async function initializeSimulations(jobId: string, count: number): Promise<void> {
  await fetch(`${API_URL}/api/jobs/${jobId}/simulations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-worker-secret': WORKER_SECRET,
    },
    body: JSON.stringify({ count }),
  });
}
```

#### 3.3.6 Pub/Sub Changes

Change `flowControl.maxMessages` from `1` to the calculated capacity:

```typescript
const subscription = pubsub.subscription(subscriptionName, {
  flowControl: {
    maxMessages: calculateDynamicParallelism(16), // Fill capacity
  },
});
```

Remove the `isProcessingJob` mutex — it's no longer needed since each simulation runs in an isolated container with no shared state.

### 3.4 Simulation Image Pre-Pull

**File:** `worker/src/worker.ts` — add to startup:

```typescript
async function ensureSimulationImage(): Promise<void> {
  console.log(`Pre-pulling simulation image: ${SIMULATION_IMAGE}`);
  const result = await runProcess('docker', ['pull', SIMULATION_IMAGE], { timeout: 300_000 });
  if (result.exitCode !== 0) {
    console.warn(`Warning: Failed to pre-pull simulation image: ${result.stderr}`);
    // Don't fail — the image might already be local
  }
}
```

---

## Phase 4 — Frontend: Incremental Progress

> **Goal:** Show per-simulation status on the `JobStatus` page in real-time.

### 4.1 Update `useJobStream` Hook

**File:** `frontend/src/hooks/useJobStream.ts`

Add handling for the new `simulations` SSE event:

```typescript
export function useJobStream<T>(jobId: string | undefined) {
  const [job, setJob] = useState<T | null>(null);
  const [simulations, setSimulations] = useState<SimulationStatus[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    // ... existing SSE setup ...

    eventSource.addEventListener('simulations', (event) => {
      try {
        const data = JSON.parse(event.data);
        setSimulations(data.simulations || []);
      } catch (e) {
        console.error('Failed to parse simulations event:', e);
      }
    });

    // ... rest unchanged ...
  }, [jobId]);

  return { job, simulations, error, connected };
}
```

### 4.2 New Component: `SimulationGrid`

**New file:** `frontend/src/components/SimulationGrid.tsx`

A visual grid showing the state of each simulation:

```tsx
interface SimulationGridProps {
  simulations: SimulationStatus[];
  totalSimulations: number;
}

export function SimulationGrid({ simulations, totalSimulations }: SimulationGridProps) {
  // Render a grid of small squares/circles, each representing one simulation
  // Color-coded: gray=PENDING, blue=RUNNING (animated pulse), green=COMPLETED, red=FAILED
  // Clicking a simulation shows a tooltip with details (duration, winner, error)
}
```

**Design goals:**
- Grid of small squares (like GitHub contribution graph)
- Sizes well for 10-200 simulations
- Animated pulse on RUNNING simulations
- Hover tooltip with details
- Responsive — wraps naturally on small screens

### 4.3 Update `JobStatus.tsx`

**File:** `frontend/src/pages/JobStatus.tsx`

Add the `SimulationGrid` component between the existing progress bar and the win tally:

```tsx
{/* Existing progress bar */}
{(job.status === 'RUNNING' || job.status === 'ANALYZING') && (
  <div className="space-y-4">
    {/* Existing text progress: X / Y games */}
    {/* Existing progress bar */}
    
    {/* NEW: Simulation grid */}
    {simulations.length > 0 && (
      <SimulationGrid
        simulations={simulations}
        totalSimulations={job.simulations}
      />
    )}
  </div>
)}
```

### 4.4 Frontend Types

**File:** `frontend/src/types.ts` (or add to existing type location)

```typescript
export type SimulationState = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export interface SimulationStatus {
  simId: string;
  index: number;
  state: SimulationState;
  workerId?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  errorMessage?: string;
  winner?: string;
  winningTurn?: number;
}
```

---

## Phase 5 — CI/CD & Infrastructure

### 5.1 GitHub Actions: Build Two Images

**File:** `.github/workflows/deploy-worker.yml`

Add a second build job for the simulation image:

```yaml
jobs:
  build-worker:
    # ... existing job, but targeting the slimmed worker/Dockerfile

  build-simulation:
    name: Build and Push Simulation Image
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v6
        with:
          context: simulation/
          push: true
          tags: |
            ghcr.io/${{ github.repository }}/simulation:latest
            ghcr.io/${{ github.repository }}/simulation:${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

### 5.2 Watchtower: Watch Both Images

**File:** `worker/docker-compose.watchtower.yml`

Add the simulation image to Watchtower's scope. Since simulation containers are ephemeral (`--rm`), Watchtower only needs to pull the new image — the worker will use it for the next simulation.

```yaml
services:
  watchtower:
    # ... existing config ...
    command: --cleanup --label-enable --interval 300
    # Watchtower will auto-update the worker container
    # Simulation images are ephemeral, but we want Watchtower to pull updates:
    environment:
      - WATCHTOWER_INCLUDE_STOPPED=true  # Pull image even if no running container uses it
```

### 5.3 Setup Script Updates

**File:** `scripts/setup-worker.sh`

Add simulation image to the initial pull:

```bash
# Pull both images
echo "Pulling worker image: $IMAGE_NAME"
docker pull "$IMAGE_NAME"

SIMULATION_IMAGE="${IMAGE_NAME/worker/simulation}"
echo "Pulling simulation image: $SIMULATION_IMAGE"
docker pull "$SIMULATION_IMAGE"
```

### 5.4 Secret Manager: Add Simulation Image

**File:** `scripts/populate-worker-secret.js`

Add `SIMULATION_IMAGE` to the `simulation-worker-config` secret:

```javascript
config.SIMULATION_IMAGE = `ghcr.io/${repo}/simulation:latest`;
```

### 5.5 Provision Worker Workflow

**File:** `.github/workflows/provision-worker.yml`

Add `SIMULATION_IMAGE` to the worker config secret alongside `IMAGE_NAME`.

---

## Phase 6 — Cleanup & Documentation

### 6.1 Remove Java/Forge from Worker Dockerfile

Once the simulation image is working, remove the following from `worker/Dockerfile`:
- All Java installation steps
- xvfb installation
- Forge directory copy
- `run_sim.sh` copy
- Environment variables for `FORGE_DIR`, `DISPLAY`, etc.

### 6.2 Update Architecture Documentation

**File:** `docs/ARCHITECTURE.md`

Update to reflect the two-image architecture, including:
- New Mermaid diagrams showing Worker → Simulation Container flow
- Updated component table
- Updated data flow sequence diagram
- New "Simulation Image" section

### 6.3 Update CLAUDE.md

**File:** `CLAUDE.md`

Update the worker section to describe both images and the new build commands.

### 6.4 Remove Deprecated Code

- `worker/src/worker.ts`: Remove `runForgeSim()`, old `processJob()` logic
- `worker/src/worker.ts`: Remove `isProcessingJob` mutex
- `worker/forge-engine/`: Move to `simulation/forge-engine/` (if not already there)

---

## Migration Strategy

### Backward Compatibility

The migration is designed to be **non-breaking**:

1. **Phase 1 (API changes)** can be deployed first. The new `simulations` endpoints return empty arrays when no simulations are tracked, and the existing `gamesCompleted` field continues to work.

2. **Phase 4 (Frontend)** is additive — the new `SimulationGrid` component only renders when simulation data is present. Old jobs without simulation tracking display as they do today.

3. **Phases 2-3 (Docker images)** are where the actual behavior changes. Both old-format workers (monolithic) and new-format workers (split) can coexist — they both hit the same API endpoints.

### Rollback Plan

If the new worker has issues:
1. Revert the worker Docker image tag to the monolithic version
2. Watchtower will auto-update workers back to the old image
3. The API continues to work with both old and new worker formats

### Testing Strategy

| What to Test | How |
|-------------|-----|
| Simulation image runs 1 game | `docker run simulation:latest` with sample decks |
| Worker launches simulation containers | Local mode with `docker-compose.local.yml` |
| Per-simulation status updates | Watch Firestore console or SSE stream |
| Frontend simulation grid | Create a job with 10+ simulations, verify real-time updates |
| Failure isolation | Kill a simulation container mid-run, verify only that sim fails |
| Resource limits | Run on a constrained machine, verify worker respects CPU/RAM limits |

---

## Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| 1 | Docker socket security — worker container has root-level Docker access | Medium | High | Worker runs as non-root user in docker group. Simulation containers run as non-root. Consider AppArmor/seccomp profiles. |
| 2 | Disk space exhaustion from simulation logs | Low | Medium | Worker cleans up job directories after aggregation. Add disk space monitoring. |
| 3 | Race condition in job completion detection | Medium | Medium | Use Firestore transactions or atomic counters for `gamesCompleted`. |
| 4 | Worker crash while simulations still running | Low | Medium | Simulation containers complete independently. On restart, worker can check for orphaned containers (`docker ps --filter label=mbs-job-id=...`). |
| 5 | Pub/Sub ack deadline exceeded for large jobs | Low | Medium | The `@google-cloud/pubsub` client auto-extends ack deadlines (up to 60 min). For very large jobs (>200 sims), consider splitting into multiple Pub/Sub messages. |
| 6 | Network failure between worker and API | Medium | Medium | Worker retries status updates with exponential backoff. Simulation results are persisted locally in log files. |
| 7 | Simulation image not pre-pulled, first run slow | Low | Low | `ensureSimulationImage()` on worker startup. Watchtower keeps image current. |

---

## Estimated Effort by Phase

| Phase | Description | Estimated Effort | Dependencies |
|-------|-------------|-----------------|--------------|
| **1** | Data model & API | 3-4 hours | None |
| **2** | Simulation Docker image | 1-2 hours | None (parallel with Phase 1) |
| **3** | Worker refactor | 4-6 hours | Phase 1 + Phase 2 |
| **4** | Frontend updates | 2-3 hours | Phase 1 (can start before Phase 3) |
| **5** | CI/CD & infrastructure | 1-2 hours | Phase 2 + Phase 3 |
| **6** | Cleanup & docs | 1-2 hours | All phases |
| **Total** | | **12-19 hours** | |

---

## File Change Summary

### New Files

| File | Phase | Purpose |
|------|-------|---------|
| `simulation/Dockerfile` | 2 | Simulation container image definition |
| `simulation/forge-engine/` | 2 | Copy of `worker/forge-engine/` for simulation image |
| `api/app/api/jobs/[id]/simulations/route.ts` | 1 | GET simulations, POST initialize |
| `api/app/api/jobs/[id]/simulations/[simId]/route.ts` | 1 | PATCH simulation status |
| `frontend/src/components/SimulationGrid.tsx` | 4 | Visual grid component |

### Modified Files

| File | Phase | Changes |
|------|-------|---------|
| `api/lib/types.ts` | 1 | Add `SimulationStatus`, `SimulationState` types |
| `api/lib/firestore-job-store.ts` | 1 | Add simulation subcollection CRUD |
| `api/lib/job-store.ts` | 1 | Add simulation table CRUD (SQLite) |
| `api/lib/job-store-factory.ts` | 1 | Add delegating simulation functions |
| `api/lib/db.ts` | 1 | Add `simulations` table creation |
| `api/app/api/jobs/[id]/stream/route.ts` | 1 | Add `simulations` SSE event |
| `worker/Dockerfile` | 3 | Remove Java/Forge, add Docker CLI |
| `worker/docker-compose.yml` | 3 | Add Docker socket mount, reduce memory |
| `worker/src/worker.ts` | 3 | Major refactor: container orchestration |
| `frontend/src/hooks/useJobStream.ts` | 4 | Handle `simulations` SSE event |
| `frontend/src/pages/JobStatus.tsx` | 4 | Add `SimulationGrid` |
| `.github/workflows/deploy-worker.yml` | 5 | Add simulation image build job |
| `worker/docker-compose.watchtower.yml` | 5 | Watch simulation image |
| `scripts/setup-worker.sh` | 5 | Pull simulation image |
| `docs/ARCHITECTURE.md` | 6 | Update architecture docs |
| `CLAUDE.md` | 6 | Update build/dev instructions |
