# Auto-Coverage System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically queue simulation jobs for under-covered deck pairs so every deck plays every other deck, establishing comprehensive power rankings.

**Architecture:** New coverage service computes pair coverage from `match_results`, generates optimal 4-player pods via greedy algorithm, and creates jobs through the existing job store. Worker requests coverage work when idle. Frontend toggle on Leaderboard page controls the system.

**Tech Stack:** Next.js API routes, SQLite/Firestore (factory pattern), React + Tailwind, existing worker polling infrastructure.

---

### Task 1: Add `source` field to Job schema

**Files:**
- Modify: `api/lib/types.ts`
- Modify: `api/lib/db.ts`
- Modify: `api/lib/job-store.ts`
- Modify: `shared/types/job.ts`

- [ ] **Step 1: Add `source` to shared types**

In `shared/types/job.ts`, add after the `REQUIRED_DECK_COUNT` constant:

```typescript
/** Source of a job: user-created or auto-coverage system. */
export type JobSource = 'user' | 'coverage';
```

In `shared/types/job.ts`, add `source?: JobSource;` to the `JobResponse` interface after the `retryCount` field:

```typescript
  /** Source of the job (user-submitted or auto-coverage). */
  source?: JobSource;
```

Also add `source?: JobSource;` to the `JobSummary` interface after `dockerRunDurationsMs`.

- [ ] **Step 2: Add `source` to internal Job type**

In `api/lib/types.ts`, add to the re-exports section:

```typescript
export type { JobSource } from '@shared/types/job';
```

Add to the imports section:

```typescript
import type { JobSource } from '@shared/types/job';
```

Add `source?: JobSource;` to the `Job` interface after `results`.

- [ ] **Step 3: Add `source` column to SQLite**

In `api/lib/db.ts`, add after the existing `needs_aggregation` column migration block (around line 176):

```typescript
  try {
    db.exec(`ALTER TABLE jobs ADD COLUMN source TEXT DEFAULT 'user'`);
  } catch {
    // Column already exists
  }
```

- [ ] **Step 4: Update SQLite job store to read/write `source`**

In `api/lib/job-store.ts`, add `source?: string | null;` to the `Row` interface.

In the `rowToJob` function, add to the return object spread:

```typescript
    ...(row.source && row.source !== 'user' && { source: row.source as JobSource }),
```

(You'll need to add `import type { JobSource } from '@shared/types/job';` at the top.)

In the `createJob` function, accept `source` as an optional parameter. Update the SQL INSERT to include source:

Change the INSERT statement to:
```sql
INSERT INTO jobs (id, decks_json, deck_ids_json, status, simulations, created_at, idempotency_key, parallelism, source)
VALUES (?, ?, ?, 'QUEUED', ?, ?, ?, ?, ?)
```

And add `source ?? 'user'` as the last bind parameter.

- [ ] **Step 5: Update job-store-factory to pass `source` through**

In `api/lib/job-store-factory.ts`, update the `createJob` function signature's `options` parameter to include `source?: JobSource`:

```typescript
export async function createJob(
  decks: DeckSlot[],
  simulations: number,
  options?: { idempotencyKey?: string; parallelism?: number; createdBy?: string; deckIds?: string[]; source?: JobSource }
): Promise<Job> {
```

Pass `options?.source` through to both the SQLite and Firestore implementations.

For SQLite:
```typescript
  return sqliteStore.createJob(
    decks,
    simulations,
    options?.idempotencyKey,
    options?.parallelism,
    options?.deckIds,
    options?.source
  );
```

For Firestore, add `source: options?.source` to the object passed to `firestoreStore.createJob`.

- [ ] **Step 6: Verify build passes**

Run: `npm run lint --prefix api`
Expected: No type errors.

- [ ] **Step 7: Commit**

```bash
git add api/lib/types.ts api/lib/db.ts api/lib/job-store.ts api/lib/job-store-factory.ts shared/types/job.ts
git commit -m "feat: add source field to Job schema for coverage system"
```

---

### Task 2: Coverage config storage (SQLite + factory)

**Files:**
- Create: `api/lib/coverage-store.ts`
- Create: `api/lib/coverage-store-sqlite.ts`
- Create: `api/lib/coverage-store-firestore.ts`
- Create: `api/lib/coverage-store-factory.ts`
- Modify: `api/lib/db.ts`

- [ ] **Step 1: Define the CoverageStore interface**

Create `api/lib/coverage-store.ts`:

```typescript
/**
 * Coverage store interface — persists auto-coverage configuration.
 * Implemented by coverage-store-sqlite.ts (LOCAL) and coverage-store-firestore.ts (GCP).
 */

export interface CoverageConfig {
  enabled: boolean;
  targetGamesPerPair: number;
  updatedAt: string;
  updatedBy: string;
}

export interface CoverageStore {
  /** Get current coverage config. Returns defaults if never set. */
  getConfig(): Promise<CoverageConfig>;

  /** Update coverage config fields. */
  updateConfig(update: Partial<Pick<CoverageConfig, 'enabled' | 'targetGamesPerPair'>>, updatedBy: string): Promise<CoverageConfig>;
}
```

- [ ] **Step 2: Add `coverage_config` table to SQLite**

In `api/lib/db.ts`, add after the `match_results` index creation (around line 311):

```typescript
  // Coverage config (singleton row)
  db.exec(`
    CREATE TABLE IF NOT EXISTS coverage_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      enabled INTEGER NOT NULL DEFAULT 0,
      target_games_per_pair INTEGER NOT NULL DEFAULT 400,
      updated_at TEXT NOT NULL DEFAULT '',
      updated_by TEXT NOT NULL DEFAULT ''
    )
  `);
```

- [ ] **Step 3: Implement SQLite coverage store**

Create `api/lib/coverage-store-sqlite.ts`:

```typescript
/**
 * SQLite implementation of CoverageStore (LOCAL mode).
 */
import type { CoverageStore, CoverageConfig } from './coverage-store';

function getDb() {
  const { getDb: _getDb } = require('./db') as { getDb: () => import('better-sqlite3').Database };
  return _getDb();
}

const DEFAULT_CONFIG: CoverageConfig = {
  enabled: false,
  targetGamesPerPair: 400,
  updatedAt: '',
  updatedBy: '',
};

export const sqliteCoverageStore: CoverageStore = {
  async getConfig(): Promise<CoverageConfig> {
    const db = getDb();
    const row = db
      .prepare('SELECT enabled, target_games_per_pair, updated_at, updated_by FROM coverage_config WHERE id = 1')
      .get() as { enabled: number; target_games_per_pair: number; updated_at: string; updated_by: string } | undefined;
    if (!row) return DEFAULT_CONFIG;
    return {
      enabled: row.enabled === 1,
      targetGamesPerPair: row.target_games_per_pair,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by,
    };
  },

  async updateConfig(update, updatedBy): Promise<CoverageConfig> {
    const db = getDb();
    const current = await this.getConfig();
    const enabled = update.enabled ?? current.enabled;
    const targetGamesPerPair = update.targetGamesPerPair ?? current.targetGamesPerPair;
    const updatedAt = new Date().toISOString();

    db.prepare(`
      INSERT INTO coverage_config (id, enabled, target_games_per_pair, updated_at, updated_by)
      VALUES (1, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        enabled = excluded.enabled,
        target_games_per_pair = excluded.target_games_per_pair,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by
    `).run(enabled ? 1 : 0, targetGamesPerPair, updatedAt, updatedBy);

    return { enabled, targetGamesPerPair, updatedAt, updatedBy };
  },
};
```

- [ ] **Step 4: Implement Firestore coverage store**

Create `api/lib/coverage-store-firestore.ts`:

```typescript
/**
 * Firestore implementation of CoverageStore (GCP mode).
 */
import type { CoverageStore, CoverageConfig } from './coverage-store';
import { getFirestore } from 'firebase-admin/firestore';

const COLLECTION = 'config';
const DOC_ID = 'coverage';

const DEFAULT_CONFIG: CoverageConfig = {
  enabled: false,
  targetGamesPerPair: 400,
  updatedAt: '',
  updatedBy: '',
};

export const firestoreCoverageStore: CoverageStore = {
  async getConfig(): Promise<CoverageConfig> {
    const doc = await getFirestore().collection(COLLECTION).doc(DOC_ID).get();
    if (!doc.exists) return DEFAULT_CONFIG;
    const data = doc.data()!;
    return {
      enabled: data.enabled ?? false,
      targetGamesPerPair: data.targetGamesPerPair ?? 400,
      updatedAt: data.updatedAt ?? '',
      updatedBy: data.updatedBy ?? '',
    };
  },

  async updateConfig(update, updatedBy): Promise<CoverageConfig> {
    const current = await this.getConfig();
    const config: CoverageConfig = {
      enabled: update.enabled ?? current.enabled,
      targetGamesPerPair: update.targetGamesPerPair ?? current.targetGamesPerPair,
      updatedAt: new Date().toISOString(),
      updatedBy,
    };
    await getFirestore().collection(COLLECTION).doc(DOC_ID).set(config);
    return config;
  },
};
```

- [ ] **Step 5: Create the factory**

Create `api/lib/coverage-store-factory.ts`:

```typescript
/**
 * Coverage store factory: delegates to Firestore when GOOGLE_CLOUD_PROJECT is set,
 * otherwise to SQLite.
 */
import type { CoverageStore } from './coverage-store';

const USE_FIRESTORE =
  typeof process.env.GOOGLE_CLOUD_PROJECT === 'string' &&
  process.env.GOOGLE_CLOUD_PROJECT.length > 0;

let _store: CoverageStore | null = null;

export function getCoverageStore(): CoverageStore {
  if (_store) return _store;
  if (USE_FIRESTORE) {
    const { firestoreCoverageStore } = require('./coverage-store-firestore') as {
      firestoreCoverageStore: CoverageStore;
    };
    return (_store = firestoreCoverageStore);
  }
  const { sqliteCoverageStore } = require('./coverage-store-sqlite') as {
    sqliteCoverageStore: CoverageStore;
  };
  return (_store = sqliteCoverageStore);
}
```

- [ ] **Step 6: Verify build passes**

Run: `npm run lint --prefix api`
Expected: No type errors.

- [ ] **Step 7: Commit**

```bash
git add api/lib/coverage-store.ts api/lib/coverage-store-sqlite.ts api/lib/coverage-store-firestore.ts api/lib/coverage-store-factory.ts api/lib/db.ts
git commit -m "feat: add coverage config storage with SQLite and Firestore backends"
```

---

### Task 3: Coverage service — pair coverage computation and pod generation

**Files:**
- Create: `api/lib/coverage-service.ts`

- [ ] **Step 1: Create coverage service**

Create `api/lib/coverage-service.ts`:

```typescript
/**
 * Coverage service: computes pair coverage from match_results and generates
 * optimal 4-player pods using a greedy algorithm.
 */
import { listAllDecks } from './deck-store-factory';

/** Canonical key for a pair of deck IDs (alphabetically sorted). */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Extract all C(4,2) = 6 pairs from a 4-deck game. */
function extractPairs(deckIds: string[]): string[] {
  const pairs: string[] = [];
  for (let i = 0; i < deckIds.length; i++) {
    for (let j = i + 1; j < deckIds.length; j++) {
      pairs.push(pairKey(deckIds[i], deckIds[j]));
    }
  }
  return pairs;
}

export interface CoverageStatus {
  totalPairs: number;
  coveredPairs: number;
  underCoveredPairs: number;
  targetGamesPerPair: number;
  percentComplete: number;
}

export interface PairCoverageMap {
  counts: Map<string, number>;
  allDeckIds: string[];
}

/**
 * Compute pair coverage from match_results.
 * Returns a map of pair -> game count and the full list of deck IDs.
 */
export async function computePairCoverage(): Promise<PairCoverageMap> {
  const [allDecks, matchResults] = await Promise.all([
    listAllDecks(),
    getAllMatchResults(),
  ]);

  const allDeckIds = allDecks.map((d) => d.id);
  const counts = new Map<string, number>();

  for (const result of matchResults) {
    const pairs = extractPairs(result.deckIds);
    for (const pair of pairs) {
      counts.set(pair, (counts.get(pair) ?? 0) + 1);
    }
  }

  return { counts, allDeckIds };
}

/**
 * Get coverage status summary.
 */
export async function getCoverageStatus(targetGamesPerPair: number): Promise<CoverageStatus> {
  const { counts, allDeckIds } = await computePairCoverage();
  const n = allDeckIds.length;
  const totalPairs = n >= 2 ? (n * (n - 1)) / 2 : 0;

  let coveredPairs = 0;
  for (let i = 0; i < allDeckIds.length; i++) {
    for (let j = i + 1; j < allDeckIds.length; j++) {
      const key = pairKey(allDeckIds[i], allDeckIds[j]);
      if ((counts.get(key) ?? 0) >= targetGamesPerPair) {
        coveredPairs++;
      }
    }
  }

  return {
    totalPairs,
    coveredPairs,
    underCoveredPairs: totalPairs - coveredPairs,
    targetGamesPerPair,
    percentComplete: totalPairs > 0 ? Math.round((coveredPairs / totalPairs) * 10000) / 100 : 100,
  };
}

/**
 * Generate the next optimal pod of 4 decks using the greedy algorithm.
 * Returns null if all pairs meet the target or fewer than 4 decks exist.
 */
export async function generateNextPod(targetGamesPerPair: number): Promise<string[] | null> {
  const { counts, allDeckIds } = await computePairCoverage();

  if (allDeckIds.length < 4) return null;

  // Build set of under-covered pairs with their counts
  const underCovered = new Map<string, number>();
  for (let i = 0; i < allDeckIds.length; i++) {
    for (let j = i + 1; j < allDeckIds.length; j++) {
      const key = pairKey(allDeckIds[i], allDeckIds[j]);
      const count = counts.get(key) ?? 0;
      if (count < targetGamesPerPair) {
        underCovered.set(key, count);
      }
    }
  }

  if (underCovered.size === 0) return null;

  // Step 1: Pick the pair (A, B) with the fewest games played
  let minCount = Infinity;
  let bestA = '';
  let bestB = '';
  for (const [key, count] of underCovered) {
    if (count < minCount) {
      minCount = count;
      const [a, b] = key.split('|');
      bestA = a;
      bestB = b;
    }
  }

  const pod = [bestA, bestB];
  const podSet = new Set(pod);

  // Step 2: Pick deck C that maximizes new under-covered pairs
  let bestC = '';
  let bestCScore = -1;
  for (const deckId of allDeckIds) {
    if (podSet.has(deckId)) continue;
    let score = 0;
    for (const existing of pod) {
      const key = pairKey(deckId, existing);
      if (underCovered.has(key)) score++;
    }
    if (score > bestCScore) {
      bestCScore = score;
      bestC = deckId;
    }
  }
  pod.push(bestC);
  podSet.add(bestC);

  // Step 3: Pick deck D that maximizes new under-covered pairs
  let bestD = '';
  let bestDScore = -1;
  for (const deckId of allDeckIds) {
    if (podSet.has(deckId)) continue;
    let score = 0;
    for (const existing of pod) {
      const key = pairKey(deckId, existing);
      if (underCovered.has(key)) score++;
    }
    if (score > bestDScore) {
      bestDScore = score;
      bestD = deckId;
    }
  }
  pod.push(bestD);

  return pod;
}

/**
 * Get all match results (deck_ids arrays) from the database.
 */
async function getAllMatchResults(): Promise<{ deckIds: string[] }[]> {
  const USE_FIRESTORE =
    typeof process.env.GOOGLE_CLOUD_PROJECT === 'string' &&
    process.env.GOOGLE_CLOUD_PROJECT.length > 0;

  if (USE_FIRESTORE) {
    const { getFirestore } = require('firebase-admin/firestore') as typeof import('firebase-admin/firestore');
    const snapshot = await getFirestore().collection('match_results').select('deckIds').get();
    return snapshot.docs.map((doc) => ({
      deckIds: doc.data().deckIds as string[],
    }));
  }

  const { getDb } = require('./db') as { getDb: () => import('better-sqlite3').Database };
  const db = getDb();
  const rows = db
    .prepare('SELECT deck_ids FROM match_results')
    .all() as { deck_ids: string }[];
  return rows.map((r) => ({
    deckIds: JSON.parse(r.deck_ids) as string[],
  }));
}
```

- [ ] **Step 2: Verify build passes**

Run: `npm run lint --prefix api`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add api/lib/coverage-service.ts
git commit -m "feat: add coverage service with pair tracking and greedy pod generation"
```

---

### Task 4: Coverage API endpoints

**Files:**
- Create: `api/app/api/coverage/config/route.ts`
- Create: `api/app/api/coverage/status/route.ts`
- Create: `api/app/api/coverage/next-job/route.ts`

- [ ] **Step 1: Create config endpoint**

Create `api/app/api/coverage/config/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyAdmin, unauthorizedResponse } from '@/lib/auth';
import { getCoverageStore } from '@/lib/coverage-store-factory';
import { errorResponse } from '@/lib/api-response';

/**
 * GET /api/coverage/config — read coverage config (any authenticated user)
 */
export async function GET(request: NextRequest) {
  try {
    await verifyAuth(request);
  } catch {
    return unauthorizedResponse();
  }

  try {
    const config = await getCoverageStore().getConfig();
    return NextResponse.json(config);
  } catch (error) {
    console.error('GET /api/coverage/config error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Failed to get config', 500);
  }
}

/**
 * PATCH /api/coverage/config — update coverage config (admin only)
 */
export async function PATCH(request: NextRequest) {
  let user;
  try {
    user = await verifyAdmin(request);
  } catch {
    return unauthorizedResponse();
  }

  try {
    const body = await request.json();
    const update: { enabled?: boolean; targetGamesPerPair?: number } = {};

    if (typeof body.enabled === 'boolean') {
      update.enabled = body.enabled;
    }
    if (typeof body.targetGamesPerPair === 'number') {
      if (body.targetGamesPerPair < 1 || body.targetGamesPerPair > 10000) {
        return errorResponse('targetGamesPerPair must be between 1 and 10000', 400);
      }
      update.targetGamesPerPair = body.targetGamesPerPair;
    }

    if (Object.keys(update).length === 0) {
      return errorResponse('No valid fields to update', 400);
    }

    const config = await getCoverageStore().updateConfig(update, user.email);
    return NextResponse.json(config);
  } catch (error) {
    console.error('PATCH /api/coverage/config error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Failed to update config', 500);
  }
}
```

- [ ] **Step 2: Create status endpoint**

Create `api/app/api/coverage/status/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, unauthorizedResponse } from '@/lib/auth';
import { getCoverageStore } from '@/lib/coverage-store-factory';
import { getCoverageStatus } from '@/lib/coverage-service';
import { errorResponse } from '@/lib/api-response';

/**
 * GET /api/coverage/status — coverage progress summary (any authenticated user)
 */
export async function GET(request: NextRequest) {
  try {
    await verifyAuth(request);
  } catch {
    return unauthorizedResponse();
  }

  try {
    const config = await getCoverageStore().getConfig();
    const status = await getCoverageStatus(config.targetGamesPerPair);
    return NextResponse.json(status);
  } catch (error) {
    console.error('GET /api/coverage/status error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Failed to get coverage status', 500);
  }
}
```

- [ ] **Step 3: Create next-job endpoint**

Create `api/app/api/coverage/next-job/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { isWorkerRequest } from '@/lib/auth';
import { getCoverageStore } from '@/lib/coverage-store-factory';
import { generateNextPod } from '@/lib/coverage-service';
import { resolveDeckIds } from '@/lib/deck-resolver';
import * as jobStore from '@/lib/job-store-factory';
import { isGcpMode } from '@/lib/job-store-factory';
import { GAMES_PER_CONTAINER } from '@/lib/types';
import { publishSimulationTasks } from '@/lib/pubsub';
import { pushToAllWorkers } from '@/lib/worker-push';
import { errorResponse } from '@/lib/api-response';

const COVERAGE_SIMULATIONS = 100;
const COVERAGE_PARALLELISM = 1;

/**
 * POST /api/coverage/next-job — worker requests next coverage job
 * Auth: worker secret only
 */
export async function POST(request: NextRequest) {
  if (!isWorkerRequest(request)) {
    return errorResponse('Unauthorized', 401);
  }

  try {
    const config = await getCoverageStore().getConfig();
    if (!config.enabled) {
      return new NextResponse(null, { status: 204 });
    }

    const pod = await generateNextPod(config.targetGamesPerPair);
    if (!pod) {
      return new NextResponse(null, { status: 204 });
    }

    const { decks, errors } = await resolveDeckIds(pod);
    if (errors.length > 0) {
      console.error(`[Coverage] Failed to resolve decks: ${errors.join(', ')}`);
      return new NextResponse(null, { status: 204 });
    }

    const job = await jobStore.createJob(decks, COVERAGE_SIMULATIONS, {
      parallelism: COVERAGE_PARALLELISM,
      createdBy: 'coverage-system',
      deckIds: pod,
      source: 'coverage',
    });

    const containerCount = Math.ceil(COVERAGE_SIMULATIONS / GAMES_PER_CONTAINER);
    await jobStore.initializeSimulations(job.id, containerCount);

    if (isGcpMode()) {
      await publishSimulationTasks(job.id, containerCount).catch((err) =>
        console.error(`[Coverage] Failed to publish tasks for job ${job.id}:`, err)
      );
    } else {
      pushToAllWorkers('/notify', {}).catch((err) =>
        console.warn('[Coverage] Worker notify failed:', err instanceof Error ? err.message : err)
      );
    }

    const deckNames = job.decks.map((d) => d.name);
    console.log(`[Coverage] Created job ${job.id}: ${deckNames.join(' vs ')}`);

    return NextResponse.json({ id: job.id, deckNames, source: 'coverage' }, { status: 201 });
  } catch (error) {
    console.error('POST /api/coverage/next-job error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Failed to create coverage job', 500);
  }
}
```

- [ ] **Step 4: Verify build passes**

Run: `npm run lint --prefix api`
Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add api/app/api/coverage/
git commit -m "feat: add coverage API endpoints (config, status, next-job)"
```

---

### Task 5: Worker integration — request coverage jobs when idle

**Files:**
- Modify: `worker/src/worker.ts`

- [ ] **Step 1: Add coverage job request function**

In `worker/src/worker.ts`, add a helper function before `pollForJobs()` (around line 812):

```typescript
/**
 * Request a coverage job from the API when idle.
 * Returns true if a coverage job was created (will be picked up next poll cycle).
 */
async function requestCoverageJob(): Promise<boolean> {
  try {
    const res = await fetch(`${getApiUrl()}/api/coverage/next-job`, {
      method: 'POST',
      headers: getApiHeaders(),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    if (res.status === 201) {
      const data = await res.json();
      console.log(`[Coverage] Requested coverage job: ${data.id}`);
      return true;
    }
    return false;
  } catch (error) {
    if (error instanceof Error && error.name !== 'TimeoutError') {
      console.error('[Coverage] Error requesting coverage job:', error);
    }
    return false;
  }
}
```

- [ ] **Step 2: Integrate into the polling loop**

In the `pollForJobs()` function, replace the final `await waitForNotifyOrTimeout(POLL_INTERVAL_MS);` (the one after the catch block, around line 867) with:

```typescript
    // No user jobs available — check for coverage work
    const coverageCreated = await requestCoverageJob();
    if (coverageCreated) {
      continue;
    }
    await waitForNotifyOrTimeout(POLL_INTERVAL_MS);
```

- [ ] **Step 3: Verify worker compiles**

Run: `cd /Users/tylerholland/Dev/MagicBracketSimulator/worker && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add worker/src/worker.ts
git commit -m "feat: worker requests coverage jobs when idle"
```

---

### Task 6: Frontend — coverage controls on Leaderboard page

**Files:**
- Modify: `frontend/src/api.ts`
- Modify: `frontend/src/pages/Leaderboard.tsx`

- [ ] **Step 1: Add coverage API functions to frontend**

In `frontend/src/api.ts`, add at the end of the file:

```typescript
// ---------------------------------------------------------------------------
// Coverage API
// ---------------------------------------------------------------------------

export interface CoverageConfig {
  enabled: boolean;
  targetGamesPerPair: number;
  updatedAt: string;
  updatedBy: string;
}

export interface CoverageStatus {
  totalPairs: number;
  coveredPairs: number;
  underCoveredPairs: number;
  targetGamesPerPair: number;
  percentComplete: number;
}

export async function getCoverageConfig(): Promise<CoverageConfig> {
  const apiBase = resolveApiBase();
  const res = await fetchWithAuth(`${apiBase}/api/coverage/config`);
  if (!res.ok) throw new Error('Failed to fetch coverage config');
  return res.json();
}

export async function updateCoverageConfig(
  update: Partial<Pick<CoverageConfig, 'enabled' | 'targetGamesPerPair'>>
): Promise<CoverageConfig> {
  const apiBase = resolveApiBase();
  const res = await fetchWithAuth(`${apiBase}/api/coverage/config`, {
    method: 'PATCH',
    body: JSON.stringify(update),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function getCoverageStatus(): Promise<CoverageStatus> {
  const apiBase = resolveApiBase();
  const res = await fetchWithAuth(`${apiBase}/api/coverage/status`);
  if (!res.ok) throw new Error('Failed to fetch coverage status');
  return res.json();
}
```

- [ ] **Step 2: Add coverage section to Leaderboard**

In `frontend/src/pages/Leaderboard.tsx`, update the imports:

```typescript
import { useState, useEffect, useCallback } from 'react';
import { getApiBase, fetchWithAuth, getCoverageConfig, updateCoverageConfig, getCoverageStatus } from '../api';
import type { CoverageConfig, CoverageStatus } from '../api';
import { useAuth } from '../contexts/AuthContext';
```

Inside the `Leaderboard` component function, add coverage state after the existing state declarations:

```typescript
  const { user } = useAuth();
  const [coverageConfig, setCoverageConfig] = useState<CoverageConfig | null>(null);
  const [coverageStatus, setCoverageStatus] = useState<CoverageStatus | null>(null);
  const [coverageLoading, setCoverageLoading] = useState(false);
  const [isAdminUser, setIsAdminUser] = useState(false);

  useEffect(() => {
    const fetchCoverage = async () => {
      try {
        const [config, status] = await Promise.all([
          getCoverageConfig(),
          getCoverageStatus(),
        ]);
        setCoverageConfig(config);
        setCoverageStatus(status);
        setIsAdminUser(true);
      } catch {
        // Coverage endpoints may not exist or user not authenticated
      }
    };
    fetchCoverage();
  }, []);

  const handleToggleCoverage = async () => {
    if (!coverageConfig) return;
    setCoverageLoading(true);
    try {
      const updated = await updateCoverageConfig({ enabled: !coverageConfig.enabled });
      setCoverageConfig(updated);
    } catch (err) {
      console.error('Failed to toggle coverage:', err);
      setIsAdminUser(false);
    } finally {
      setCoverageLoading(false);
    }
  };

  const handleTargetChange = async (newTarget: number) => {
    setCoverageLoading(true);
    try {
      const updated = await updateCoverageConfig({ targetGamesPerPair: newTarget });
      setCoverageConfig(updated);
    } catch (err) {
      console.error('Failed to update target:', err);
    } finally {
      setCoverageLoading(false);
    }
  };
```

Add the coverage JSX section at the end of the component's return, after the TrueSkill explanation paragraph and before the closing `</div>`:

```tsx
      {/* Coverage System */}
      {coverageStatus && (
        <div className="mt-6 bg-gray-800 rounded-lg border border-gray-700 px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-gray-300">Deck Coverage</h3>
            {isAdminUser && coverageConfig && (
              <button
                type="button"
                onClick={handleToggleCoverage}
                disabled={coverageLoading}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  coverageConfig.enabled ? 'bg-blue-600' : 'bg-gray-600'
                } ${coverageLoading ? 'opacity-50' : ''}`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    coverageConfig.enabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            )}
          </div>

          <div className="w-full bg-gray-700 rounded-full h-2 mb-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${coverageStatus.percentComplete}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-gray-400">
            <span>
              {coverageStatus.coveredPairs} / {coverageStatus.totalPairs} pairs covered
            </span>
            <span>{coverageStatus.percentComplete}%</span>
          </div>

          {isAdminUser && coverageConfig && (
            <div className="mt-3 flex items-center gap-2 text-xs text-gray-400">
              <span>Target games per pair:</span>
              {[100, 200, 400, 800].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => handleTargetChange(n)}
                  disabled={coverageLoading}
                  className={`px-2 py-0.5 rounded font-medium transition-colors ${
                    coverageConfig.targetGamesPerPair === n
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
```

- [ ] **Step 3: Verify frontend builds**

Run: `npm run build --prefix frontend`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api.ts frontend/src/pages/Leaderboard.tsx
git commit -m "feat: add coverage controls to Leaderboard page"
```

---

### Task 7: Firestore job store — persist `source` field

**Files:**
- Modify: `api/lib/firestore-job-store.ts`
- Modify: `api/lib/job-store-factory.ts`

- [ ] **Step 1: Update Firestore job store**

Read `api/lib/firestore-job-store.ts` to understand the `createJob` function and the Firestore document-to-Job conversion function.

In the `createJob` function, add `source` to the data written to the Firestore document: `source: input.source ?? 'user'`.

In the function that converts Firestore documents to Job objects (look for a function that reads `data.status`, `data.simulations`, etc.), add:

```typescript
...(data.source && data.source !== 'user' && { source: data.source }),
```

- [ ] **Step 2: Update job-store-factory Firestore path**

In `api/lib/job-store-factory.ts`, in the `createJob` function's Firestore branch, ensure `source` is passed through:

```typescript
    return firestoreStore.createJob({
      decks,
      simulations,
      parallelism: options?.parallelism,
      idempotencyKey: options?.idempotencyKey,
      createdBy: options?.createdBy ?? 'unknown',
      deckIds: options?.deckIds,
      source: options?.source,
    });
```

- [ ] **Step 3: Verify build passes**

Run: `npm run lint --prefix api`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add api/lib/firestore-job-store.ts api/lib/job-store-factory.ts
git commit -m "feat: persist source field in Firestore job store"
```

---

### Task 8: Integration verification

**Files:**
- No new files.

- [ ] **Step 1: Full API build check**

Run: `npm run lint --prefix api && npm run build --prefix api`
Expected: Both pass.

- [ ] **Step 2: Full frontend build check**

Run: `npm run lint --prefix frontend && npm run build --prefix frontend`
Expected: Both pass.

- [ ] **Step 3: Run existing unit tests**

Run: `npm run test:unit --prefix api`
Expected: All existing tests pass.

- [ ] **Step 4: Final fixup commit if needed**

If any build/lint issues were found and fixed, commit them.
