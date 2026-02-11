# Magic Bracket Simulator — Architecture Overview

This document describes the system architecture, with emphasis on the dual-mode operation and the Forge simulation engine.

---

## Deployment Modes

The system supports two deployment modes:

1. **Local Development** - All services run locally using Docker orchestration.
2. **GCP Cloud Deployment** - Cloud Run API with a **Unified Worker** running simulations.

---

## GCP Cloud Architecture (Recommended for Production)

In GCP Mode, the system uses a **Unified Worker** architecture. A single container image combines the Node.js worker and the Java/Forge runtime. This worker pulls jobs from Pub/Sub and executes simulations as internal child processes (not Docker-in-Docker), which improves performance and simplifies deployment.

```mermaid
flowchart TB
    subgraph gcp [GCP Cloud - Free Tier]
        CloudRun[Cloud Run<br/>Next.js App]
        Firestore[(Firestore)]
        GCS[(Cloud Storage)]
        PubSub[Pub/Sub]
        FirebaseAuth[Firebase Auth]
        SecretManager[Secret Manager]

        CloudRun --> Firestore
        CloudRun --> GCS
        CloudRun --> PubSub
        FirebaseAuth --> CloudRun
        SecretManager -.-> CloudRun
    end

    subgraph worker_env [Worker Environment (Local or Cloud)]
        UnifiedWorker[Unified Worker Container<br/>Node.js + Java + Forge]

        UnifiedWorker -- Pull --> PubSub
        UnifiedWorker -- Upload Logs --> GCS
        UnifiedWorker -- Get/Update Job --> CloudRun
        SecretManager -.-> UnifiedWorker
    end

    User --> CloudRun
```

### GCP Components

| Component | Service | Purpose |
|-----------|---------|---------|
| **API + Frontend** | Cloud Run | Single Next.js app serving API routes and optional frontend |
| **Job Metadata** | Firestore | Job state, deck references, results |
| **Artifacts** | Cloud Storage | Raw logs, condensed logs, analysis payloads |
| **Job Queue** | Pub/Sub | Triggers workers when jobs are created |
| **Authentication** | Firebase Auth | Google sign-in with email allowlist |
| **Secrets** | Secret Manager | Gemini API key, Worker secrets |

### Unified Worker (GCP Mode)

| Component | Directory | Purpose |
|-----------|-----------|---------|
| **Unified Worker** | `local-worker/` (src)<br>`unified-worker/` (docker) | Pulls from Pub/Sub, executes `run_sim.sh` internally, condenses logs, uploads to GCS. |

### GCP Data Flow

```mermaid
sequenceDiagram
    participant User
    participant CloudRun as Cloud Run
    participant Firestore
    participant PubSub
    participant UnifiedWorker
    participant GCS

    User->>CloudRun: POST /api/jobs (create job)
    CloudRun->>Firestore: Store job (QUEUED)
    CloudRun->>PubSub: Publish job-created message
    CloudRun-->>User: 201 Created

    PubSub->>UnifiedWorker: Pull message
    UnifiedWorker->>CloudRun: GET job details

    note right of UnifiedWorker: Parallel Execution (Child Processes)
    UnifiedWorker->>UnifiedWorker: Spawn run_sim.sh (Run 1)
    UnifiedWorker->>UnifiedWorker: Spawn run_sim.sh (Run N)

    UnifiedWorker->>UnifiedWorker: Condense logs
    UnifiedWorker->>GCS: Upload artifacts (logs, analysis payload)
    UnifiedWorker->>CloudRun: PATCH job COMPLETED

    User->>CloudRun: POST /api/jobs/:id/analyze
    CloudRun->>GCS: Get analyze payload
    CloudRun->>CloudRun: Call Gemini API
    CloudRun->>Firestore: Store results
    CloudRun-->>User: Analysis results
```

---

## Local Development Architecture (Original)

In Local Mode, the Orchestrator Service acts as the central hub. It spawns a background worker thread that orchestrates **Docker containers** to run simulations. This mimics the parallelism of the cloud environment but uses local resources.

### High-Level Architecture

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
| **Orchestrator** | 3000 | Next.js API + background Worker. Job store in SQLite. |
| **Log Analyzer** | 3001 | Ingests logs from Worker; condenses/structures; stores. |
| **Analysis Service** | 8000 | Python + Gemini. On-demand AI analysis of condensed logs. |
| **Forge (Docker)** | — | One image `forge-sim`; multiple containers run in parallel per job. |

---

## Data Flow (Local)

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

## Parallelism and Limits

### How Many Parallel Tasks?

- **Jobs**: The worker processes **one job at a time**.
- **Simulations (within one job)**: For the **current** job, the worker executes up to **N** parallel streams, where **N = that job’s parallelism**.

### Source of Parallelism Value

| Source | Description |
|--------|-------------|
| **Default** | `DEFAULT_PARALLELISM = 4` |
| **Environment** | `FORGE_PARALLELISM` overrides the default if set |
| **Per job** | Request body when creating the job (1–16) |

### Unified Worker Dynamic Parallelism (GCP Mode)
The Unified Worker (`local-worker`) includes logic to **dynamically adjust** parallelism based on available CPU and Memory to prevent OOM kills. It reserves ~2GB for the system and ~600MB per simulation.

---

## Repo Layout (Reference)

| Directory | Purpose | Mode |
|-----------|---------|------|
| **frontend/** | Web UI (Vite + React) with Firebase Auth | Both |
| **orchestrator-service/** | Next.js API: decks, precons, jobs, Gemini analysis | Both |
| **local-worker/** | Source for Unified Worker (GCP). Runs simulations internally. | GCP |
| **unified-worker/** | Docker build context for `local-worker` + Forge. | GCP |
| **forge-simulation-engine/** | Docker image for `forge-sim` (used in Local Mode). | Local |
| **forge-log-analyzer/** | Log condensing service. | Local |
| **analysis-service/** | Python + Gemini service. | Local |
| **misc-runner/** | **Deprecated**. Functionality merged into `local-worker`. | Legacy |
