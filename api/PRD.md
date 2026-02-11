# Product Requirement Document: Orchestrator Service

## 1. Overview
The **Orchestrator Service** is the user-facing "brain" of the application. It handles deck ingestion from external sites (Moxfield/Archidekt/ManaBox), manages the queue of simulation jobs, and displays the final results.

## 2. Goals
-   **Easy Onboarding**: Users need a deck URL (Moxfield, Archidekt, or ManaBox) to add decks.
-   **Async Processing**: UI should not hang while 5-10 minute simulations run.
-   **Scalability**: Manage multiple simulation requests without crashing the single Forge instance (Queue system).

## 3. Specifications

### 3.1 Tech Stack (Unified)
-   **Framework**: **Next.js 14+ (App Router)**. This handles both the Frontend UI and the API/Backend logic.
-   **Database**: PostgreSQL (via Prisma or Drizzle) or SQLite (for local dev).
-   **Queue**: `bullmq` (Redis) or a simple DB-based poller if Redis is overkill. *Recommendation: Start with DB-polling for simplicity, upgrade to Redis if scale is needed.*

### 3.2 Feature Specifications

#### A. Frontend UI
-   **Input Form**:
    -   `Deck URL` (validated for moxfield.com / archidekt.com / manabox.app only).
    -   `Opponent Selector`: Dropdown of "Random Precons" or "Specific Precons" (served from a static list).
    -   `Simulations`: Slider (1-10).
-   **Status Dashboard**:
    -   Real-time polling of Job Status.
    -   Visual progress bar ("Game 2 of 5").
    -   **Results View**: Display the Analysis JSON (Bracket, Confidence, Reasoning) and simple stats (Win Rate).

#### B. Backend Services (Next.js API Routes / Server Actions)
-   **Deck Ingestion**:
    -   Service to fetch metadata from Moxfield/Archidekt APIs and ManaBox deck pages.
    -   `Converter`: Logic to transform imports into `.dck` format.
-   **Job Lifecycle & Data Model**:
    -   **Job Table**:
        -   `id`: UUID
        -   `deck_name`: String
        -   `deck_dck`: Text (blob)
        -   `status`: ENUM (QUEUED, RUNNING, ANALYZING, COMPLETED, FAILED)
        -   `result_json`: JSON (nullable)
        -   `created_at`: Date
-   **Worker Logic (Background Process)**:
    -   Can be a separate Node.js script `worker.js` that connects to the DB.
    -   **Loop**:
        1.  Find `PENDING` Job.
        2.  Mark `RUNNING`.
        3.  Spawn Docker: `docker run -v ... forge-sim ...`
        4.  Wait for exit.
        5.  Read Logs from volume.
        6.  Send Logs to **Analysis Service** API.
        7.  Save Response to `result_json`.
        8.  Mark `COMPLETED`.

### 3.3 Opponent Selection Logic
-   The Orchestrator maintains a list of the 50 predefined precons (matching the Forge Engine's internal list).
-   **Randomizer**: Randomly selects 3 unique names from this list to pass to the Docker container.

## 4. Key Workflows
1.  **User submits URL**.
2.  **Next.js Backend** fetches deck, creates `Job` record (Status: QUEUED).
3.  **Worker** picks up Job.
4.  **Worker** executes `docker run` with volume mounts for the deck file.
5.  **Worker** gathers logs, calls Analysis Service `POST /analyze`.
6.  **Worker** updates DB.
7.  **Frontend** polls DB and shows "Bracket 4: Optimized" to user.

## 5. Work Plan
1.  **Scaffold**: Create Next.js App with matching DB schema.
2.  **Ingestion**: Implement Moxfield/Archidekt/ManaBox scrapers.
3.  **Worker**: Build the `worker.js` process to handle Docker spawning.
4.  **Integration**: connect Worker -> Forge (Docker) -> Analysis (API).
