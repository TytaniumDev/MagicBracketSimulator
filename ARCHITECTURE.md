# Magic Bracket Simulator — Architecture Overview

This document describes the system architecture, with emphasis on the Docker-based Forge engine and how parallel execution works.

---

## High-Level Architecture

```mermaid
flowchart TB
    subgraph user[" "]
        Browser["User / Browser"]
    end

    subgraph frontend["Frontend"]
        UI["Web UI - Vite + React port 5173"]
    end

    subgraph orchestrator["Orchestrator"]
        API["API - decks, precons, jobs"]
        Store[(SQLite Job Store)]
        Worker["Worker Loop"]
        API --> Store
        Worker --> Store
    end

    subgraph loganalyzer["Log Analyzer"]
        Condenser["Condense / Structure logs"]
        StoreLogs["Store raw logs - port 3001"]
    end

    subgraph docker["Docker"]
        C1["Container 1"]
        C2["Container 2"]
        C3["Container N - forge-sim image"]
        N1["1-8 containers per job"]
    end

    subgraph forge["Forge Engine"]
        RunSim["run_sim.sh"]
        Xvfb["xvfb"]
        ForgeCLI["Forge CLI sim"]
        RunSim --> Xvfb --> ForgeCLI
    end

    subgraph analysis["Analysis Service"]
        Gemini["Gemini AI - port 8000"]
    end

    Browser --> UI
    UI --> API
    UI --> Condenser
    Worker --> Docker
    Docker --> Forge
    Worker -->|"POST logs"| LogAnalyzer
    LogAnalyzer -->|"condensed logs"| Analysis
    UI -->|"trigger analyze"| LogAnalyzer
```

---

## Component Summary

| Component | Port | Role |
|-----------|------|------|
| **Frontend** | 5173 | Web UI (Vite + React). Calls Orchestrator API and Log Analyzer. |
| **Orchestrator** | 3000 | Next.js API (decks, precons, jobs) + background Worker. Job store in SQLite. |
| **Log Analyzer** | 3001 | Ingests logs from Worker; condenses/structures; stores; can forward to Analysis Service. |
| **Analysis Service** | 8000 | Python + Gemini. On-demand AI analysis of condensed logs. |
| **Forge (Docker)** | — | One image `forge-sim`; multiple containers run in parallel per job. |

---

## Data Flow

```mermaid
sequenceDiagram
    participant User
    participant Frontend
    participant Orchestrator
    participant Worker
    participant Docker
    participant LogAnalyzer
    participant Analysis

    User->>Frontend: Create job - 4 decks, simulations, parallelism
    Frontend->>Orchestrator: POST /api/jobs
    Orchestrator->>Orchestrator: Store job QUEUED

    Worker->>Orchestrator: Poll next QUEUED job
    Worker->>Worker: Write 4 deck files to job decks dir
    par Parallel containers
        Worker->>Docker: docker run forge-sim run 0
        Worker->>Docker: docker run forge-sim run 1
        Worker->>Docker: docker run forge-sim run N
    end
    Docker-->>Worker: Logs in job logs dir
    Worker->>LogAnalyzer: POST job logs with deck lists
    Worker->>Orchestrator: Mark job COMPLETED

    User->>Frontend: View job or trigger analysis
    Frontend->>LogAnalyzer: GET logs, POST analyze
    LogAnalyzer->>Analysis: Forward payload
    Analysis-->>LogAnalyzer: Bracket results
    LogAnalyzer-->>Frontend: Analysis result
```

---

## Docker and Forge Engine

### One Image, Multiple Containers per Job

- **Single image**: `forge-sim`, built from `forge-simulation-engine/Dockerfile` (Eclipse Temurin 17, Forge release, xvfb, precons, `run_sim.sh` entrypoint).
- **Per job**: The worker spawns **multiple** `docker run` processes **in parallel**. So you get **multiple container instances** at once, all using the same image.

```mermaid
flowchart LR
    subgraph job["One job"]
        W["Worker - 20 sims, parallelism 4"]
    end

    subgraph containers["Parallel containers - same image"]
        D1["Run 0 - 5 games"]
        D2["Run 1 - 5 games"]
        D3["Run 2 - 5 games"]
        D4["Run 3 - 5 games"]
    end

    W --> D1
    W --> D2
    W --> D3
    W --> D4
```

- **Simulation split**: Total simulations are divided across `parallelism` runs (e.g. 20 sims, parallelism 4 → four containers with 5 games each). Each container gets the same deck mount but a distinct `--id` (e.g. `job_<id>_run0`, `job_<id>_run1`) so log filenames don’t clash.
- **Volumes**: Each `docker run` mounts the same job dirs: `jobs/<jobId>/decks` → `/app/decks`, `jobs/<jobId>/logs` → `/app/logs`. All containers write into the same logs directory with different filename prefixes.

### Forge Inside the Container

Each container runs the same flow:

| Step | What happens |
|------|----------------|
| **Entrypoint** | `/app/run_sim.sh` (`forge-simulation-engine/run_sim.sh`) |
| **Input** | `/app/decks` (mounted from worker’s `jobs/<jobId>/decks/`) with 4 `.dck` files; `--id` and `--simulations` per run |
| **Execution** | Copies decks into Forge’s Commander deck path; runs Forge under **xvfb** (virtual display): `xvfb-run ... forge.sh sim -d ... -f Commander -n <simulations> -c 300` |
| **Output** | Logs written under `/app/logs` (mounted from worker’s `jobs/<jobId>/logs/`) as `{runId}_game_1.txt`, etc. Worker reads these after all containers exit |

---

## Parallelism and Limits

### How Many Parallel Tasks?

- **Jobs**: The worker processes **one job at a time**. It’s a single loop: pick next QUEUED job → `await processJob(job)` → repeat. So there is no parallel execution of **different** jobs.
- **Containers (within one job)**: For the **current** job, the worker runs up to **N** containers in parallel, where **N = that job’s parallelism** (or default/env).

```mermaid
flowchart TB
    subgraph limits["Concurrency limits"]
        J["Jobs in flight = 1"]
        C["Containers in flight = 1 to 8"]
    end

    subgraph source["Where N comes from"]
        Default["Default 4"]
        Env["FORGE_PARALLELISM env"]
        JobParam["Per-job parallelism 1-8"]
        JobParam --> C
        Env --> Default
        Default --> C
    end
```

### Where the Parallelism Value Comes From

| Source | Description |
|--------|-------------|
| **Default** | `DEFAULT_PARALLELISM = 4` in `orchestrator-service/worker/worker.ts` |
| **Environment** | `FORGE_PARALLELISM` overrides the default if set |
| **Per job** | Request body when creating the job can send `parallelism` (frontend does this); validated to 1–8 |

Effective parallelism for a job: `job.parallelism ?? FORGE_PARALLELISM ?? 4`, clamped by the 1–8 API validation.

### Explicit Limits

| Limit | Value | Location |
|-------|--------|----------|
| **Per-job parallelism** | 1–8 | `PARALLELISM_MIN` / `PARALLELISM_MAX` in `orchestrator-service/lib/types.ts` |
| **Max concurrent Docker containers** | Same as current job’s parallelism | 1–8 |
| **Concurrent jobs** | 1 | Worker loop processes a single job at a time |

There is **no** explicit global “max concurrent containers across all jobs” — effectively it’s “one job at a time, up to 8 containers for that job.” The next job starts only after the current one finishes. Beyond that, the real ceiling is host CPU/memory and Docker daemon limits.

---

## Repo Layout (reference)

| Directory | Purpose |
|-----------|---------|
| **frontend/** | Web UI (Vite + React). Only user-facing app. |
| **orchestrator-service/** | API and worker: deck ingestion, job store, simulation orchestration. |
| **forge-log-analyzer/** | Parses, condenses, and structures Forge game logs; forwards to Analysis Service. |
| **analysis-service/** | Python + Gemini: analyzes condensed logs and assigns power bracket (1–5). |
| **forge-simulation-engine/** | Docker-based Forge simulation runner (image + `run_sim.sh`). |

---

## Quick Reference: Key Code

- **Worker parallelism and Docker spawn**: `orchestrator-service/worker/worker.ts` — `splitSimulations`, `processJob`, `runForgeDocker`.
- **Job store and types**: `orchestrator-service/lib/job-store.ts`, `orchestrator-service/lib/types.ts` — `PARALLELISM_MIN` / `PARALLELISM_MAX`, `createJob(..., parallelism?)`.
- **Forge container entrypoint**: `forge-simulation-engine/run_sim.sh`.
- **Image build**: `forge-simulation-engine/Dockerfile`.
