# GCP Migration Fix Plan

> **Note:** All file paths in this document are relative to the repository root unless otherwise specified.

## Architecture Overview (What Each Component Does)

Your current architecture is well-designed for GCP's free tier. Here's what each piece does:

### Cloud Components (GCP - Free Tier Friendly)
1. **orchestrator-service on Cloud Run** - Next.js API backend
   - Handles HTTP requests from frontend (create jobs, manage decks, analyze results)
   - Stores job metadata in Firestore
   - Publishes job events to Pub/Sub
   - Runs Gemini AI analysis
   - **Free tier**: 2M requests/month, 180,000 vCPU-seconds/month

2. **Firestore** - NoSQL database
   - Stores job metadata, deck information, user allowlist
   - **Free tier**: 50K reads, 20K writes, 1GB storage per day

3. **Cloud Storage (GCS)** - File storage
   - Stores job artifacts (game logs, analysis results)
   - **Free tier**: 5GB storage, 5K operations per month

4. **Pub/Sub** - Message queue
   - Carries job creation events from orchestrator to worker
   - **Free tier**: 10GB messages per month

### Local Components (Your Machine)
5. **local-worker** - Node.js process on your machine
   - Subscribes to Pub/Sub for job events
   - Runs Docker containers (forge-sim, misc-runner)
   - Why local? Heavy CPU work (MTG simulations) would cost money in cloud

6. **misc-runner** - Go container (runs in Docker locally)
   - Condenses game logs
   - Uploads artifacts to Cloud Storage
   - Updates job status via orchestrator API

7. **frontend** - React app
   - Can run locally or be deployed to Firebase Hosting
   - Talks to orchestrator-service API

### Why This Architecture?
- **API on Cloud Run**: Always accessible, no server management, free tier is generous
- **Worker locally**: Free computation, runs 1-16 Docker containers in parallel
- **Pub/Sub queue**: Decouples API from workers, reliable message delivery
- **Firestore + GCS**: Persistent storage without running databases

---

## Critical Issues Found

### Issue 1: No Environment Configuration ⚠️
**Problem**: `orchestrator-service/.env` doesn't exist, so it defaults to LOCAL mode (SQLite) instead of GCP mode (Firestore/Pub/Sub)

**Impact**:
- Jobs are stored in local SQLite instead of Firestore
- No Pub/Sub messages published
- Worker can't discover jobs
- Mode mismatch between services

**Files affected**:
- `orchestrator-service/.env` (missing)
- `orchestrator-service/lib/job-store-factory.ts` (uses `GOOGLE_CLOUD_PROJECT` to switch modes)
- `orchestrator-service/lib/deck-store-factory.ts` (uses `GOOGLE_CLOUD_PROJECT` to switch modes)

### Issue 2: Precons Not Seeded to Firestore ⚠️
**Problem**: Precon decks exist only in filesystem (`forge-simulation-engine/precons/`), not in Firestore

**Impact**:
- API can't list precons when in GCP mode
- Jobs referencing precons will fail

**Files affected**:
- `orchestrator-service/lib/precons.ts` (loads from filesystem)
- `orchestrator-service/lib/firestore-decks.ts` (expects precons in Firestore)

### Issue 3: Local Worker Configuration Mismatch ⚠️
**Problem**: `local-worker/.env` points to Cloud Run URL that may not be deployed yet

**Impact**:
- Worker can't fetch job details
- Worker can't update job status
- Jobs stuck in QUEUED state

**Files affected**:
- `local-worker/.env` (API_URL points to Cloud Run)

### Issue 4: No Mode Detection Logging ℹ️
**Problem**: No visibility into which mode (local vs GCP) the system is running in

**Impact**:
- Hard to debug issues
- Unclear if configuration is working

**Files affected**:
- `orchestrator-service/lib/job-store-factory.ts`
- `orchestrator-service/lib/deck-store-factory.ts`

### Issue 5: Confusing Development Scripts ℹ️
**Problem**: `npm run dev` starts all services including legacy ones (log-analyzer, analysis-service) that aren't needed in GCP mode

**Impact**:
- Wastes resources
- Confusing which services are active
- Unclear how to run in different modes

**Files affected**:
- `package.json` (root)

### Issue 6: Legacy Services Not Documented ℹ️
**Problem**: `forge-log-analyzer/` and `analysis-service/` are legacy but still present

**Impact**:
- Unclear which services are needed
- Confusing architecture

**Files affected**:
- `forge-log-analyzer/`
- `analysis-service/`

---

## Implementation Plan

### Phase 1: Configure Environment for GCP Mode

**Goal**: Enable GCP mode in orchestrator-service

#### Step 1.1: Create orchestrator-service/.env
Create `.env` file in orchestrator-service directory by copying from `.env.example` and configuring:

```bash
# GCP Configuration
GOOGLE_CLOUD_PROJECT="magic-bracket-simulator"
GCS_BUCKET="magic-bracket-simulator-artifacts"
PUBSUB_TOPIC="job-created"

# Gemini API key (get from https://aistudio.google.com/app/apikey)
GEMINI_API_KEY="<your-actual-key>"

# Firebase Admin credentials (path to service account key JSON)
GOOGLE_APPLICATION_CREDENTIALS="/home/wsl/magic-bracket-simulator-worker-key.json"

# Worker secret (for local-worker and misc-runner authentication)
WORKER_SECRET="<generate-a-random-secret>"

# Local development settings (not needed when deployed to Cloud Run)
NODE_ENV="development"
FORGE_ENGINE_PATH="../forge-simulation-engine"
```

**Critical values**:
- `GOOGLE_CLOUD_PROJECT`: Must be set to activate GCP mode (Firestore, Pub/Sub, GCS)
- `GOOGLE_APPLICATION_CREDENTIALS`: Path to service account key (already exists at `/home/wsl/magic-bracket-simulator-worker-key.json` based on local-worker config)
- `WORKER_SECRET`: Generate a secure random string, must match in local-worker/.env

**Verification**: Starting orchestrator should log "Mode: GCP (Firestore)"

#### Step 1.2: Update local-worker/.env
Ensure `local-worker/.env` has:
- `WORKER_SECRET` matching orchestrator (add if missing)
- `API_URL` set to either:
  - `http://localhost:3000` (for local orchestrator testing)
  - `https://orchestrator-jfmj7qwxca-uc.a.run.app` (for deployed Cloud Run)

**Files to create/modify**:
- `orchestrator-service/.env` - **CREATE**
- `local-worker/.env` - **MODIFY** (add WORKER_SECRET)

---

### Phase 2: Seed Precons to Firestore

**Goal**: Populate Firestore with precon decks so they're accessible via API

#### Step 2.1: Check if seed script exists
The exploration found a script reference, need to verify it exists at `orchestrator-service/scripts/seed-decks.ts`

#### Step 2.2: Run seed script
From orchestrator-service directory:
```bash
cd orchestrator-service
npx tsx scripts/seed-decks.ts
```

This will:
1. Read all `.dck` files from `../forge-simulation-engine/precons/`
2. Read `manifest.json` for metadata
3. Create Firestore documents in `decks` collection with `isPrecon: true`
4. Include full deck content so workers don't need filesystem

**Expected output**: "Seeded N precons to Firestore"

**Verification**: Check Firestore console for `decks` collection with `isPrecon: true` documents

**Files involved**:
- `orchestrator-service/scripts/seed-decks.ts` (if exists; may need to create)
- `forge-simulation-engine/precons/manifest.json`

---

### Phase 3: Add Mode Detection Logging

**Goal**: Make it obvious which mode the system is running in

#### Step 3.1: Add startup logging to job-store-factory.ts
In `orchestrator-service/lib/job-store-factory.ts`, after the `USE_FIRESTORE` constant:

```typescript
const USE_FIRESTORE = typeof process.env.GOOGLE_CLOUD_PROJECT === 'string'
  && process.env.GOOGLE_CLOUD_PROJECT.length > 0;

console.log(`[Job Store] Running in ${USE_FIRESTORE ? 'GCP' : 'LOCAL'} mode`);
if (USE_FIRESTORE) {
  console.log(`[Job Store] Project: ${process.env.GOOGLE_CLOUD_PROJECT}`);
  console.log(`[Job Store] Using: Firestore + Cloud Storage + Pub/Sub`);
} else {
  console.log(`[Job Store] Using: SQLite + local filesystem`);
}
```

#### Step 3.2: Add startup logging to deck-store-factory.ts
Similar logging in `orchestrator-service/lib/deck-store-factory.ts`

**Files to modify**:
- `orchestrator-service/lib/job-store-factory.ts:9` - **MODIFY**
- `orchestrator-service/lib/deck-store-factory.ts:13-14` - **MODIFY**

---

### Phase 4: Update Development Scripts

**Goal**: Make it clear how to run in GCP mode vs LOCAL mode

#### Step 4.1: Add mode-specific scripts to root package.json
Update `package.json` to add:

```json
{
  "scripts": {
    "dev": "node scripts/run-dev.js",
    "dev:local": "node ./node_modules/concurrently/dist/bin/concurrently.js -n analysis,log-analyzer,orchestrator,frontend,worker -c blue,cyan,green,yellow,magenta \"npm run analysis\" \"npm run log-analyzer\" \"npm run orchestrator\" \"npm run frontend\" \"npm run worker\"",
    "dev:gcp": "node ./node_modules/concurrently/dist/bin/concurrently.js -n orchestrator,frontend -c green,yellow \"npm run orchestrator\" \"npm run frontend\"",
    "worker:gcp": "npm run dev --prefix local-worker"
  }
}
```

**Usage**:
- `npm run dev:local` - LOCAL mode (SQLite, polling worker, legacy services)
- `npm run dev:gcp` - GCP mode (Firestore, Pub/Sub, NO legacy services)
- `npm run worker:gcp` - Run local-worker separately (for GCP mode)

#### Step 4.2: Update run-dev.js to detect mode
Modify `scripts/run-dev.js` to check for `GOOGLE_CLOUD_PROJECT` in orchestrator .env and run appropriate script

**Files to modify**:
- `package.json` - **MODIFY** (add scripts)
- `scripts/run-dev.js` - **MODIFY** (mode detection)

---

### Phase 5: Build Docker Images

**Goal**: Ensure forge-sim and misc-runner images are built and available

#### Step 5.1: Build forge-sim image
```bash
cd forge-simulation-engine
docker build -t forge-sim:latest .
```

#### Step 5.2: Build misc-runner image
```bash
cd misc-runner
docker build -t misc-runner:latest .
```

**Verification**: `docker images | grep -E "(forge-sim|misc-runner)"`

**Files involved**:
- `forge-simulation-engine/Dockerfile`
- `misc-runner/Dockerfile`

---

### Phase 6: Deploy Orchestrator to Cloud Run (Optional but Recommended)

**Goal**: Deploy orchestrator-service to Cloud Run for persistent API endpoint

#### Step 6.1: Ensure Cloud Build configuration is correct
Check `orchestrator-service/cloudbuild.yaml` for correct settings

#### Step 6.2: Deploy using Cloud Build
```bash
cd orchestrator-service
gcloud builds submit --config cloudbuild.yaml
```

Or use the existing Cloud Run deployment command

#### Step 6.3: Update local-worker/.env with Cloud Run URL
Set `API_URL` to the deployed Cloud Run URL

**Alternative**: For local testing, set `API_URL=http://localhost:3000` and run orchestrator locally

**Files involved**:
- `orchestrator-service/cloudbuild.yaml`
- `orchestrator-service/Dockerfile`
- `local-worker/.env`

---

### Phase 7: Document Architecture and Setup

**Goal**: Create clear documentation for understanding and running the system

#### Step 7.1: Create MODE_SETUP.md at root
Document:
- Which mode you're running (local vs GCP)
- How to switch modes
- Environment variables for each mode
- How to start services for each mode
- Troubleshooting tips

#### Step 7.2: Update ARCHITECTURE.md
Add:
- Current deployment status section
- Which services are active vs legacy
- Mode detection explanation
- Cost estimate for GCP free tier

#### Step 7.3: Add README.md sections
Link to MODE_SETUP.md and architecture doc

**Files to create/modify**:
- `MODE_SETUP.md` - **CREATE**
- `ARCHITECTURE.md` - **MODIFY** (add status section)
- `README.md` - **MODIFY** (add setup links)

---

### Phase 8: Handle Legacy Services

**Goal**: Clarify status of legacy services

#### Step 8.1: Add README to forge-log-analyzer
Create `forge-log-analyzer/README.md` explaining:
- Used only in LOCAL mode
- Replaced by misc-runner (Go) in GCP mode
- Kept for backward compatibility

#### Step 8.2: Add README to analysis-service
Create `analysis-service/README.md` explaining:
- Used only in LOCAL mode
- Replaced by Gemini integration in orchestrator in GCP mode
- Kept for backward compatibility

**Alternative**: If not needed, remove these directories entirely

**Files to create**:
- `forge-log-analyzer/README.md` - **CREATE**
- `analysis-service/README.md` - **CREATE**

---

## Verification Steps

### After Phase 1-3: Test GCP Mode Locally

**Setup**:
1. Orchestrator configured with `GOOGLE_CLOUD_PROJECT` set
2. Precons seeded to Firestore
3. Start orchestrator: `npm run orchestrator`

**Tests**:
- [ ] Orchestrator logs show "Running in GCP mode"
- [ ] Visit http://localhost:3000/api/decks - should return precons from Firestore
- [ ] Visit http://localhost:3000/api/precons - should return precons
- [ ] Create a job via API - should create Firestore document
- [ ] Check Firestore console - job should be visible with status QUEUED

### After Phase 5-6: Test Worker Processing

**Setup**:
1. Orchestrator running (local or Cloud Run)
2. Docker images built
3. local-worker/.env configured with correct API_URL
4. Start worker: `npm run worker:gcp`

**Tests**:
- [ ] Worker logs show "Connected to Pub/Sub"
- [ ] Create job via API
- [ ] Worker logs show "Received job: <jobId>"
- [ ] Worker spawns forge-sim containers
- [ ] Worker spawns misc-runner container
- [ ] Check Firestore - job status changes to IN_PROGRESS then COMPLETED
- [ ] Check Cloud Storage - artifacts uploaded to `jobs/<jobId>/`
- [ ] API GET /api/jobs/:id - should show completed job with results

### End-to-End Test

**Full flow**:
1. Start orchestrator: `npm run orchestrator`
2. Start frontend: `npm run frontend`
3. Start worker: `npm run worker:gcp`
4. Open http://localhost:5173
5. Create a new job with 2 precon decks
6. Watch worker logs for progress
7. Check job status in UI
8. Verify results appear in UI
9. Check Firestore for job record
10. Check Cloud Storage for artifacts

---

## Priority and Sequencing

### Immediate (Fix Today)
1. **Phase 1**: Create orchestrator .env with GOOGLE_CLOUD_PROJECT
2. **Phase 2**: Seed precons to Firestore
3. **Phase 5**: Build Docker images
4. **Verify**: Test GCP mode locally

### Important (This Week)
5. **Phase 3**: Add mode detection logging
6. **Phase 6**: Deploy to Cloud Run (or decide on local-only)
7. **Verify**: Test worker processing end-to-end

### Nice to Have (When Time Permits)
8. **Phase 4**: Update development scripts
9. **Phase 7**: Document architecture
10. **Phase 8**: Handle legacy services

---

## Key Files Summary

### Critical Files to Modify:
1. `orchestrator-service/.env` - **CREATE** (enables GCP mode)
2. `local-worker/.env` - **MODIFY** (add WORKER_SECRET, verify API_URL)
3. `orchestrator-service/lib/job-store-factory.ts` - **MODIFY** (add logging)
4. `orchestrator-service/lib/deck-store-factory.ts` - **MODIFY** (add logging)

### Files to Create:
1. `MODE_SETUP.md` - Documentation for running modes
2. `forge-log-analyzer/README.md` - Legacy service documentation
3. `analysis-service/README.md` - Legacy service documentation

### Files to Update:
1. `package.json` - Add mode-specific scripts
2. `ARCHITECTURE.md` - Add current status section
3. `scripts/run-dev.js` - Add mode detection

### Files to Verify:
1. `orchestrator-service/scripts/seed-decks.ts` - Check if exists
2. `orchestrator-service/cloudbuild.yaml` - Verify deployment config
3. `/home/wsl/magic-bracket-simulator-worker-key.json` - Verify service account key exists

---

## Expected Outcomes

After completing this plan:

✅ **Jobs will process successfully**
- Orchestrator creates jobs in Firestore
- Publishes to Pub/Sub
- Worker receives messages and processes jobs
- Results stored in Cloud Storage

✅ **Mode is clear and consistent**
- Startup logs show which mode is active
- All services use the same mode
- Easy to switch between local and GCP

✅ **Architecture is understood**
- Clear documentation of what each component does
- Cost estimates for GCP free tier
- Setup instructions for each mode

✅ **Cloud deployment works**
- Orchestrator on Cloud Run (or clear path to deploy)
- Worker runs locally, connects to cloud services
- Frontend can connect to cloud API

✅ **Free tier friendly**
- Uses Cloud Run, Firestore, Cloud Storage, Pub/Sub
- All services have generous free tiers
- Unlikely to exceed free tier limits for personal use
