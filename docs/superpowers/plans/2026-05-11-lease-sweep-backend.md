# Lease-Sweep Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Firestore-backed worker-lease mechanism plus a self-rescheduling Cloud Task that reverts RUNNING sims when their owning worker's lease expires (default ~27s detection vs. today's 120s+ heartbeat-based recovery). Ships safely with zero Flutter workers in existence — the sweep returns nothing until they appear.

**Architecture:** Adds an optional `lease: { expiresAt, activeSimIds }` field to existing `workers/{id}` Firestore docs. A new pure module (`api/lib/lease-sweep.ts`) holds the predicate and revert logic. A new admin endpoint (`POST /api/admin/sweep-leases`) runs the sweep and self-reschedules via Cloud Tasks every 12 seconds. Coexists with all existing recovery (60s heartbeat, 15-min hard sweep) — never touches workers without a `lease` field.

**Tech Stack:** Next.js 15 (api/), `@google-cloud/firestore`, `@google-cloud/tasks`, `tsx` for tests, `firebase-admin` SDK.

---

## File structure

| File | Action | Responsibility |
|---|---|---|
| `api/lib/types.ts` | Modify | Extend `WorkerInfo` with optional `workerType` and `lease` fields |
| `api/lib/lease-sweep.ts` | Create | Pure predicate (`isLeaseExpired`) + orchestration (`sweepExpiredLeases`); imports Firestore via the worker store |
| `api/lib/lease-sweep.test.ts` | Create | Unit tests for the pure predicate + orchestration with injected fake store |
| `api/lib/firestore-worker-store.ts` | Modify | Add `getWorkersWithExpiredLeases(now)` and `markWorkerCrashed(workerId)` helpers |
| `api/lib/job-store-factory.ts` | Modify | Add `revertSimToPending(jobId, simId, expectedWorkerId)` factory function (Firestore impl + SQLite no-op for local mode) |
| `api/lib/firestore-job-store.ts` | Modify | Implement `revertSimToPending` with a transaction that checks `state == 'RUNNING'` and `workerId == expectedWorkerId` before flipping |
| `api/lib/job-store.ts` | Modify | Add no-op synchronous `revertSimToPending` (LOCAL/SQLite mode never has Flutter workers) |
| `api/lib/cloud-tasks.ts` | Modify | Add `scheduleLeaseSweep(delaySeconds)` helper, mirroring existing `scheduleRecoveryCheck` |
| `api/app/api/admin/sweep-leases/route.ts` | Create | POST endpoint: auth check, run sweep, self-reschedule, return JSON result |
| `api/test/lease-sweep-endpoint.test.ts` | Create | Integration test against a running dev server: insert worker doc with expired lease + RUNNING sim, hit endpoint, verify revert |
| `api/package.json` | Modify | Add `tsx lib/lease-sweep.test.ts` to `test:unit`; add `tsx test/lease-sweep-endpoint.test.ts` to a new `test:lease` script |

---

## Task 1: Extend WorkerInfo type with lease fields

**Files:**
- Modify: `api/lib/types.ts`

- [ ] **Step 1: Locate the existing WorkerInfo type**

Run: `grep -n "WorkerInfo" api/lib/types.ts`
Expected: shows the existing interface definition with fields like `workerId`, `workerName`, `lastHeartbeat`, etc.

- [ ] **Step 2: Add the new optional fields**

In `api/lib/types.ts`, find the `WorkerInfo` interface and add these optional fields at the bottom of the interface body (above the closing `}`):

```typescript
  /**
   * Distinguishes worker implementations. Optional for backward compat
   * with existing Docker workers (which never set this field).
   */
  workerType?: 'docker' | 'flutter';

  /**
   * Lease metadata. Only Flutter workers write this. Lease expiry drives
   * the lease-sweep recovery path (see api/lib/lease-sweep.ts).
   */
  lease?: {
    expiresAt: string;          // ISO timestamp; sweep query: where('lease.expiresAt', '<', now)
    activeSimIds: string[];     // sims this worker currently holds RUNNING
  };
```

- [ ] **Step 3: Verify typecheck passes**

Run: `npm run lint --prefix api`
Expected: no new TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add api/lib/types.ts
git commit -m "feat(api): add optional lease fields to WorkerInfo type"
```

---

## Task 2: Add pure isLeaseExpired predicate + tests

**Files:**
- Create: `api/lib/lease-sweep.ts`
- Create: `api/lib/lease-sweep.test.ts`

- [ ] **Step 1: Write the failing predicate tests**

Create `api/lib/lease-sweep.test.ts` with this content:

```typescript
/**
 * Tests for the lease-sweep pure predicate and orchestration.
 * Run with: npx tsx lib/lease-sweep.test.ts
 */
import { isLeaseExpired, sweepExpiredLeases } from './lease-sweep';
import type { WorkerInfo } from './types';

interface TestResult { name: string; passed: boolean; error?: string; }
const results: TestResult[] = [];

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log(`✓ ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({ name, passed: false, error: message });
    console.log(`✗ ${name}`);
    console.log(`  Error: ${message}`);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function makeWorker(overrides: Partial<WorkerInfo> = {}): WorkerInfo {
  return {
    workerId: 'w1',
    workerName: 'test-worker',
    status: 'idle',
    capacity: 4,
    activeSimulations: 0,
    uptimeMs: 0,
    lastHeartbeat: new Date().toISOString(),
    ...overrides,
  } as WorkerInfo;
}

async function runTests() {
  console.log('Running lease-sweep tests...\n');

  const nowMs = Date.UTC(2026, 4, 11, 12, 0, 0);
  const future = new Date(nowMs + 10_000).toISOString();
  const past = new Date(nowMs - 1_000).toISOString();

  await test('worker without lease is not expired', () => {
    const w = makeWorker();
    assert(isLeaseExpired(w, nowMs) === false, 'no lease should be false');
  });

  await test('worker with future lease is not expired', () => {
    const w = makeWorker({ lease: { expiresAt: future, activeSimIds: [] } });
    assert(isLeaseExpired(w, nowMs) === false, 'future lease should be false');
  });

  await test('worker with past lease is expired', () => {
    const w = makeWorker({ lease: { expiresAt: past, activeSimIds: ['s1'] } });
    assert(isLeaseExpired(w, nowMs) === true, 'past lease should be true');
  });

  await test('worker with lease at exact now is not expired (strictly less)', () => {
    const exactly = new Date(nowMs).toISOString();
    const w = makeWorker({ lease: { expiresAt: exactly, activeSimIds: [] } });
    assert(isLeaseExpired(w, nowMs) === false, 'exact now should be false (use <, not <=)');
  });

  // ── Summary ───────────────────────────────────────────────
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests();
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npx tsx lib/lease-sweep.test.ts`
Expected: FAIL with module-not-found error like `Cannot find module './lease-sweep'`.

- [ ] **Step 3: Create the module with the predicate**

Create `api/lib/lease-sweep.ts` with this content:

```typescript
/**
 * Lease-sweep recovery for Flutter workers.
 *
 * Flutter workers write a lease to their workers/{id} doc, refreshed every
 * 5 seconds with expiresAt = now + 15s. If a worker disappears (crash, network
 * drop, host sleep), the lease expires within 15 seconds. This module provides
 * the predicate and orchestration to detect expired leases and revert
 * affected RUNNING sims back to PENDING for re-claim.
 *
 * Docker workers never write a lease field, so the sweep query
 *   where('lease.expiresAt', '<', now)
 * automatically excludes them. There is no risk of touching Docker workers.
 */
import type { WorkerInfo } from './types';

export interface LeaseSweepDeps {
  getWorkersWithExpiredLeases: (nowMs: number) => Promise<WorkerInfo[]>;
  revertSimToPending: (
    jobId: string,
    simId: string,
    expectedWorkerId: string,
  ) => Promise<boolean>;
  markWorkerCrashed: (workerId: string) => Promise<void>;
}

export interface LeaseSweepResult {
  workersScanned: number;
  simsReverted: number;
  errors: string[];
}

/**
 * Pure predicate. Returns true iff the worker has a lease and the
 * lease.expiresAt timestamp is strictly less than nowMs.
 */
export function isLeaseExpired(worker: WorkerInfo, nowMs: number): boolean {
  if (!worker.lease) return false;
  return new Date(worker.lease.expiresAt).getTime() < nowMs;
}

/**
 * Run a single sweep pass. Side effects are isolated to the injected deps.
 * Sim ID format used in lease.activeSimIds is `${jobId}:${simId}` to avoid
 * an extra Firestore lookup (Flutter worker writes them in this format).
 */
export async function sweepExpiredLeases(
  deps: LeaseSweepDeps,
  nowMs: number = Date.now(),
): Promise<LeaseSweepResult> {
  const result: LeaseSweepResult = {
    workersScanned: 0,
    simsReverted: 0,
    errors: [],
  };

  const expired = await deps.getWorkersWithExpiredLeases(nowMs);
  result.workersScanned = expired.length;

  for (const worker of expired) {
    if (!worker.lease) continue; // defensive; query should guarantee this
    for (const compositeId of worker.lease.activeSimIds) {
      const [jobId, simId] = compositeId.split(':');
      if (!jobId || !simId) {
        result.errors.push(`malformed activeSimId: ${compositeId}`);
        continue;
      }
      try {
        const reverted = await deps.revertSimToPending(jobId, simId, worker.workerId);
        if (reverted) result.simsReverted += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`revert ${compositeId} on ${worker.workerId}: ${msg}`);
      }
    }
    try {
      await deps.markWorkerCrashed(worker.workerId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`markCrashed ${worker.workerId}: ${msg}`);
    }
  }

  return result;
}
```

- [ ] **Step 4: Run the predicate tests to verify they pass**

Run: `cd api && npx tsx lib/lease-sweep.test.ts`
Expected: 4 passed, 0 failed (predicate tests only — orchestration tests come next).

- [ ] **Step 5: Commit**

```bash
git add api/lib/lease-sweep.ts api/lib/lease-sweep.test.ts
git commit -m "feat(api): add isLeaseExpired predicate + lease-sweep skeleton"
```

---

## Task 3: Add orchestration tests with fake deps

**Files:**
- Modify: `api/lib/lease-sweep.test.ts`

- [ ] **Step 1: Add orchestration tests to the existing test file**

In `api/lib/lease-sweep.test.ts`, insert these tests inside `runTests()`, immediately before the `// ── Summary` comment block:

```typescript
  // ── sweepExpiredLeases orchestration ────────────────────────

  await test('sweepExpiredLeases reverts sims for each expired worker', async () => {
    const expiredWorker = makeWorker({
      workerId: 'w1',
      lease: { expiresAt: past, activeSimIds: ['j1:s1', 'j1:s2'] },
    });
    const reverted: string[] = [];
    const crashed: string[] = [];

    const result = await sweepExpiredLeases({
      getWorkersWithExpiredLeases: async () => [expiredWorker],
      revertSimToPending: async (jobId, simId) => {
        reverted.push(`${jobId}:${simId}`);
        return true;
      },
      markWorkerCrashed: async (workerId) => {
        crashed.push(workerId);
      },
    }, nowMs);

    assert(result.workersScanned === 1, `expected 1 scanned, got ${result.workersScanned}`);
    assert(result.simsReverted === 2, `expected 2 reverted, got ${result.simsReverted}`);
    assert(reverted.length === 2 && reverted[0] === 'j1:s1' && reverted[1] === 'j1:s2',
      `wrong reverted list: ${JSON.stringify(reverted)}`);
    assert(crashed.length === 1 && crashed[0] === 'w1',
      `wrong crashed list: ${JSON.stringify(crashed)}`);
    assert(result.errors.length === 0, `unexpected errors: ${result.errors.join(', ')}`);
  });

  await test('sweepExpiredLeases skips revert when revertSimToPending returns false', async () => {
    const expiredWorker = makeWorker({
      workerId: 'w1',
      lease: { expiresAt: past, activeSimIds: ['j1:s1'] },
    });

    const result = await sweepExpiredLeases({
      getWorkersWithExpiredLeases: async () => [expiredWorker],
      revertSimToPending: async () => false, // sim was already non-RUNNING
      markWorkerCrashed: async () => {},
    }, nowMs);

    assert(result.simsReverted === 0, 'should not count when revert returned false');
  });

  await test('sweepExpiredLeases collects errors but continues across workers', async () => {
    const w1 = makeWorker({
      workerId: 'w1',
      lease: { expiresAt: past, activeSimIds: ['j1:s1'] },
    });
    const w2 = makeWorker({
      workerId: 'w2',
      lease: { expiresAt: past, activeSimIds: ['j2:s1'] },
    });

    const result = await sweepExpiredLeases({
      getWorkersWithExpiredLeases: async () => [w1, w2],
      revertSimToPending: async (jobId) => {
        if (jobId === 'j1') throw new Error('boom');
        return true;
      },
      markWorkerCrashed: async () => {},
    }, nowMs);

    assert(result.workersScanned === 2, 'should scan both workers');
    assert(result.simsReverted === 1, 'should revert the second worker');
    assert(result.errors.length === 1, `expected 1 error, got ${result.errors.length}`);
    assert(result.errors[0].includes('boom'), `unexpected error text: ${result.errors[0]}`);
  });

  await test('sweepExpiredLeases skips malformed activeSimIds', async () => {
    const expiredWorker = makeWorker({
      workerId: 'w1',
      lease: { expiresAt: past, activeSimIds: ['no-colon-here'] },
    });

    const result = await sweepExpiredLeases({
      getWorkersWithExpiredLeases: async () => [expiredWorker],
      revertSimToPending: async () => true,
      markWorkerCrashed: async () => {},
    }, nowMs);

    assert(result.simsReverted === 0, 'should not revert malformed entries');
    assert(result.errors.length === 1, `expected 1 error, got ${result.errors.length}`);
    assert(result.errors[0].includes('malformed'), `unexpected error text: ${result.errors[0]}`);
  });
```

- [ ] **Step 2: Run all tests to verify they pass**

Run: `cd api && npx tsx lib/lease-sweep.test.ts`
Expected: 8 passed, 0 failed.

- [ ] **Step 3: Commit**

```bash
git add api/lib/lease-sweep.test.ts
git commit -m "test(api): add orchestration tests for sweepExpiredLeases"
```

---

## Task 4: Add Firestore helpers for expired-lease query and crashed marker

**Files:**
- Modify: `api/lib/firestore-worker-store.ts`

- [ ] **Step 1: Extend the existing top-of-file import to include FieldValue**

In `api/lib/firestore-worker-store.ts`, find the existing line:

```typescript
import { Timestamp } from '@google-cloud/firestore';
```

Replace it with:

```typescript
import { Timestamp, FieldValue } from '@google-cloud/firestore';
```

- [ ] **Step 2: Add the two new helpers at the bottom of the file**

After the existing exports in `api/lib/firestore-worker-store.ts`, append:

```typescript
/**
 * Query workers whose lease.expiresAt is strictly before nowMs.
 * Workers without a lease field are automatically excluded from this query
 * (Firestore inequality queries skip docs missing the field). Docker workers
 * never write a lease, so they cannot match.
 */
export async function getWorkersWithExpiredLeases(nowMs: number): Promise<WorkerInfo[]> {
  const cutoffIso = new Date(nowMs).toISOString();
  const snapshot = await workersCollection
    .where('lease.expiresAt', '<', cutoffIso)
    .get();
  return snapshot.docs.map(doc => {
    const data = doc.data();
    return {
      workerId: doc.id,
      workerName: data.workerName,
      status: data.status,
      capacity: data.capacity,
      activeSimulations: data.activeSimulations,
      uptimeMs: data.uptimeMs,
      lastHeartbeat: data.lastHeartbeat,
      currentJobId: data.currentJobId ?? undefined,
      version: data.version ?? undefined,
      ownerEmail: data.ownerEmail ?? undefined,
      workerApiUrl: data.workerApiUrl ?? undefined,
      workerType: data.workerType ?? undefined,
      lease: data.lease ?? undefined,
    } as WorkerInfo;
  });
}

/**
 * Mark a worker as crashed and clear its lease. Idempotent — a second
 * call after the doc has been cleared is a no-op.
 */
export async function markWorkerCrashed(workerId: string): Promise<void> {
  await workersCollection.doc(workerId).set({
    status: 'crashed',
    lease: FieldValue.delete(),
  }, { merge: true });
}
```

- [ ] **Step 3: Verify typecheck passes**

Run: `npm run lint --prefix api`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add api/lib/firestore-worker-store.ts
git commit -m "feat(api): add expired-lease query and markWorkerCrashed helpers"
```

---

## Task 5: Add revertSimToPending across job-store factory

**Files:**
- Modify: `api/lib/job-store-factory.ts`
- Modify: `api/lib/firestore-job-store.ts`
- Modify: `api/lib/job-store.ts`

The SQLite store lives at `api/lib/job-store.ts` (not `sqlite-job-store.ts`). Its functions are synchronous and return `T | undefined`; the factory normalizes them.

- [ ] **Step 1: Add the SQLite no-op (LOCAL mode never has Flutter workers)**

In `api/lib/job-store.ts`, add this exported synchronous function at the bottom of the file (alongside the other exported `function` declarations):

```typescript
/**
 * No-op in LOCAL/SQLite mode. Flutter workers only run in GCP mode where
 * the Firestore implementation handles this with a transactional check.
 */
export function revertSimToPending(
  _jobId: string,
  _simId: string,
  _expectedWorkerId: string,
): boolean {
  return false;
}
```

- [ ] **Step 2: Add the Firestore implementation**

In `api/lib/firestore-job-store.ts`, add this exported function at the bottom of the file:

```typescript
/**
 * Atomically revert a sim from RUNNING → PENDING if and only if it is
 * currently RUNNING and owned by expectedWorkerId. Returns true if the
 * revert happened, false if the precondition was not met (sim already
 * terminal, or claimed by a different worker, or otherwise no longer ours).
 *
 * The expectedWorkerId guard prevents double-revert if two sweep ticks
 * race, and prevents touching sims that have already been re-claimed by
 * a healthy worker.
 */
export async function revertSimToPending(
  jobId: string,
  simId: string,
  expectedWorkerId: string,
): Promise<boolean> {
  const simRef = jobsCollection.doc(jobId).collection('simulations').doc(simId);

  return await firestore.runTransaction(async (tx) => {
    const snap = await tx.get(simRef);
    if (!snap.exists) return false;
    const data = snap.data();
    if (!data) return false;
    if (data.state !== 'RUNNING') return false;
    if (data.workerId !== expectedWorkerId) return false;

    tx.update(simRef, {
      state: 'PENDING',
      workerId: null,
      workerName: null,
      revertedAt: new Date().toISOString(),
      revertReason: 'lease-expired',
    });
    return true;
  });
}
```

- [ ] **Step 3: Wire both implementations into the factory**

In `api/lib/job-store-factory.ts`, add this exported function in the same style as the other delegating functions in the file (the lazy-import path matches how the file already loads SQLite functions):

```typescript
export async function revertSimToPending(
  jobId: string,
  simId: string,
  expectedWorkerId: string,
): Promise<boolean> {
  if (USE_FIRESTORE) {
    return firestoreStore.revertSimToPending(jobId, simId, expectedWorkerId);
  }
  const sqliteStore = await import('./job-store');
  return sqliteStore.revertSimToPending(jobId, simId, expectedWorkerId);
}
```

- [ ] **Step 4: Verify typecheck passes**

Run: `npm run lint --prefix api`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add api/lib/job-store-factory.ts api/lib/firestore-job-store.ts api/lib/job-store.ts
git commit -m "feat(api): add transactional revertSimToPending across stores"
```

---

## Task 6: Add Cloud Tasks scheduler for lease sweep

**Files:**
- Modify: `api/lib/cloud-tasks.ts`

- [ ] **Step 1: Add scheduleLeaseSweep alongside the existing scheduleRecoveryCheck**

Open `api/lib/cloud-tasks.ts`. After the existing `scheduleRecoveryCheck` function, add:

```typescript
/**
 * Schedule the next lease-sweep run. Used by the sweep endpoint to
 * self-reschedule after each invocation. Default delay 12 seconds —
 * combined with the 15s lease window, this gives ~27s worst-case
 * detection of a crashed Flutter worker.
 *
 * Uses a fixed task name (overwriting any existing scheduled task) so we
 * never accumulate duplicate sweeps if the endpoint is invoked manually
 * during scheduled-task downtime.
 */
export async function scheduleLeaseSweep(delaySeconds = 12): Promise<void> {
  const client = getClient();
  const queuePath = getQueuePath();
  if (!client || !queuePath) return;

  const apiBase = getApiBaseUrl();
  const taskName = `${queuePath}/tasks/lease-sweep`;

  // Delete any existing task with this name so we can re-create it.
  // ALREADY_EXISTS protection (delete-then-create) avoids stuck stale tasks.
  try {
    await client.deleteTask({ name: taskName });
  } catch (err: unknown) {
    const code = (err as { code?: number }).code;
    if (code !== 5) { // 5 = NOT_FOUND, expected on first run or after fire
      console.warn('[CloudTasks] lease-sweep delete pre-create failed:', err);
    }
  }

  const scheduleTime = {
    seconds: Math.floor(Date.now() / 1000) + delaySeconds,
  };

  try {
    await client.createTask({
      parent: queuePath,
      task: {
        name: taskName,
        scheduleTime,
        httpRequest: {
          httpMethod: 'POST',
          url: `${apiBase}/api/admin/sweep-leases`,
          headers: {
            'Content-Type': 'application/json',
            'X-Worker-Secret': process.env.WORKER_SECRET ?? '',
          },
          body: Buffer.from(JSON.stringify({})).toString('base64'),
        },
      },
    });
  } catch (err: unknown) {
    const code = (err as { code?: number }).code;
    if (code !== 6) { // 6 = ALREADY_EXISTS — race; benign
      console.warn('[CloudTasks] lease-sweep schedule failed:', err);
    }
  }
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npm run lint --prefix api`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add api/lib/cloud-tasks.ts
git commit -m "feat(api): add scheduleLeaseSweep Cloud Tasks helper"
```

---

## Task 7: Add the sweep endpoint with self-rescheduling

**Files:**
- Create: `api/app/api/admin/sweep-leases/route.ts`

- [ ] **Step 1: Verify the existing isWorkerRequest helper is the right auth primitive**

Run: `grep -rn "isWorkerRequest" api/app/api/admin/`
Expected: shows `isWorkerRequest` used in `sweep-stale-jobs/route.ts`.

- [ ] **Step 2: Create the endpoint**

Create `api/app/api/admin/sweep-leases/route.ts` with this content:

```typescript
/**
 * POST /api/admin/sweep-leases
 *
 * Invoked by Cloud Tasks every ~12 seconds. Reverts RUNNING sims whose
 * owning worker's lease has expired, marks the worker crashed, then
 * self-reschedules.
 *
 * In LOCAL mode (no GOOGLE_CLOUD_PROJECT), the Firestore worker store is
 * not in use, so this endpoint is a no-op returning empty stats.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { isWorkerRequest } from '@/lib/auth';
import { sweepExpiredLeases } from '@/lib/lease-sweep';
import {
  getWorkersWithExpiredLeases,
  markWorkerCrashed,
} from '@/lib/firestore-worker-store';
import { revertSimToPending } from '@/lib/job-store-factory';
import { scheduleLeaseSweep } from '@/lib/cloud-tasks';

const USE_FIRESTORE = typeof process.env.GOOGLE_CLOUD_PROJECT === 'string'
  && process.env.GOOGLE_CLOUD_PROJECT.length > 0;

export async function POST(req: NextRequest) {
  if (!isWorkerRequest(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (!USE_FIRESTORE) {
    return NextResponse.json({
      workersScanned: 0,
      simsReverted: 0,
      errors: [],
      mode: 'local-noop',
    });
  }

  const startedAt = Date.now();
  let result;
  try {
    result = await sweepExpiredLeases({
      getWorkersWithExpiredLeases,
      revertSimToPending,
      markWorkerCrashed,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({
      event: 'lease-sweep-error',
      message,
      durationMs: Date.now() - startedAt,
    }));
    // Still attempt to reschedule so a transient error doesn't break the chain.
    await scheduleLeaseSweep();
    return NextResponse.json({ error: message }, { status: 500 });
  }

  console.log(JSON.stringify({
    event: 'lease-sweep-complete',
    workersScanned: result.workersScanned,
    simsReverted: result.simsReverted,
    errors: result.errors,
    durationMs: Date.now() - startedAt,
  }));

  await scheduleLeaseSweep();
  return NextResponse.json(result);
}
```

- [ ] **Step 3: Verify typecheck passes**

Run: `npm run lint --prefix api`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add api/app/api/admin/sweep-leases/route.ts
git commit -m "feat(api): add /api/admin/sweep-leases endpoint with self-reschedule"
```

---

## Task 8: Add integration test against running dev server

**Files:**
- Create: `api/test/lease-sweep-endpoint.test.ts`
- Modify: `api/package.json`

- [ ] **Step 1: Confirm the existing integration test structure**

Run: `head -40 api/test/cancel-recover.test.ts`
Expected: shows the `test()` and `assert()` helpers, sets `TEST_URL`, hits the dev server with fetch.

- [ ] **Step 2: Write the integration test**

Create `api/test/lease-sweep-endpoint.test.ts` with this content:

```typescript
/**
 * Integration test: insert a Firestore worker doc with an expired lease and
 * a RUNNING sim that references it, hit /api/admin/sweep-leases, then verify
 * the sim was reverted to PENDING and the worker marked 'crashed'.
 *
 * Requires:
 *   - GOOGLE_CLOUD_PROJECT and GCP creds available
 *   - WORKER_SECRET in env
 *   - Dev server running with the same Firestore project
 *
 * Run: npx tsx test/lease-sweep-endpoint.test.ts
 */
import { Firestore } from '@google-cloud/firestore';

const TEST_URL = process.env.TEST_URL ?? 'http://localhost:3000';
const WORKER_SECRET = process.env.WORKER_SECRET;

interface TestResult { name: string; passed: boolean; error?: string; }
const results: TestResult[] = [];

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log(`✓ ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({ name, passed: false, error: message });
    console.log(`✗ ${name}`);
    console.log(`  Error: ${message}`);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

async function runTests() {
  if (!WORKER_SECRET) {
    console.error('WORKER_SECRET env var required');
    process.exit(1);
  }

  const firestore = new Firestore();
  const stamp = `test-lease-${Date.now()}`;
  const workerId = `${stamp}-worker`;
  const jobId = `${stamp}-job`;
  const simId = `sim-001`;

  console.log(`\nRunning lease-sweep integration test (stamp=${stamp})...\n`);

  // ── Setup: insert worker with expired lease + RUNNING sim ────────
  const expiredAt = new Date(Date.now() - 5_000).toISOString();
  await firestore.collection('workers').doc(workerId).set({
    workerName: stamp,
    status: 'idle',
    capacity: 4,
    activeSimulations: 1,
    uptimeMs: 0,
    lastHeartbeat: new Date().toISOString(),
    workerType: 'flutter',
    lease: {
      expiresAt: expiredAt,
      activeSimIds: [`${jobId}:${simId}`],
    },
  });
  await firestore.collection('jobs').doc(jobId).collection('simulations').doc(simId).set({
    simId,
    index: 0,
    state: 'RUNNING',
    workerId,
    workerName: stamp,
    startedAt: new Date().toISOString(),
  });

  try {
    // ── Hit the endpoint ─────────────────────────────────────────────
    await test('endpoint returns 200 and reports the sim was reverted', async () => {
      const res = await fetch(`${TEST_URL}/api/admin/sweep-leases`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Worker-Secret': WORKER_SECRET,
        },
        body: '{}',
      });
      assert(res.status === 200, `expected 200, got ${res.status}`);
      const body = await res.json();
      assert(body.workersScanned >= 1, `expected workersScanned >= 1, got ${body.workersScanned}`);
      assert(body.simsReverted >= 1, `expected simsReverted >= 1, got ${body.simsReverted}`);
    });

    await test('sim was flipped to PENDING with workerId cleared', async () => {
      const snap = await firestore
        .collection('jobs').doc(jobId)
        .collection('simulations').doc(simId)
        .get();
      const data = snap.data();
      assert(data?.state === 'PENDING', `expected PENDING, got ${data?.state}`);
      assert(data?.workerId === null, `expected workerId cleared, got ${data?.workerId}`);
      assert(data?.revertReason === 'lease-expired', `expected revertReason='lease-expired', got ${data?.revertReason}`);
    });

    await test('worker was marked crashed and lease cleared', async () => {
      const snap = await firestore.collection('workers').doc(workerId).get();
      const data = snap.data();
      assert(data?.status === 'crashed', `expected status='crashed', got ${data?.status}`);
      assert(data?.lease === undefined, `expected lease cleared, got ${JSON.stringify(data?.lease)}`);
    });

    await test('a second sweep tick is a no-op for the same worker', async () => {
      const res = await fetch(`${TEST_URL}/api/admin/sweep-leases`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Worker-Secret': WORKER_SECRET,
        },
        body: '{}',
      });
      const body = await res.json();
      // The worker now has no lease, so it should not appear in the query.
      // Other test data may exist from concurrent runs; we only assert our worker
      // is no longer in the candidate set.
      assert(res.status === 200, `expected 200 on second tick, got ${res.status}`);
      // No specific count assertion — just confirm endpoint completes cleanly.
      void body;
    });
  } finally {
    // ── Cleanup ──────────────────────────────────────────────────────
    await firestore.collection('jobs').doc(jobId).collection('simulations').doc(simId).delete();
    await firestore.collection('jobs').doc(jobId).delete();
    await firestore.collection('workers').doc(workerId).delete();
  }

  // ── Summary ──────────────────────────────────────────────────────
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests();
```

- [ ] **Step 3: Add the test to package.json**

In `api/package.json`, add this line to the `scripts` object (after `test:integration`):

```json
    "test:lease": "tsx test/lease-sweep-endpoint.test.ts",
```

Also add the unit test to the existing `test:unit` script. Find the existing line that starts with `"test:unit": "tsx test/state-machine.test.ts && ...` and append `&& tsx lib/lease-sweep.test.ts` to the end of its value (before the closing quote).

- [ ] **Step 4: Run the unit test as part of the unit suite**

Run: `npm run test:unit --prefix api`
Expected: all existing tests pass plus the 8 lease-sweep tests pass.

- [ ] **Step 5: Run the integration test against a running dev server**

Pre-req: dev server running with GCP creds. From a separate terminal:
```bash
cd api && npm run dev
```

Then in the original terminal:
```bash
cd api && WORKER_SECRET=$(gcloud secrets versions access latest --secret=worker-secret) npm run test:lease
```
Expected: 4 passed, 0 failed.

- [ ] **Step 6: Commit**

```bash
git add api/test/lease-sweep-endpoint.test.ts api/package.json
git commit -m "test(api): add integration test for lease-sweep endpoint"
```

---

## Task 9: Bootstrap the first sweep enqueue

**Files:**
- Create: `api/scripts/bootstrap-lease-sweep.ts`
- Modify: `api/package.json`

The lease-sweep is self-rescheduling, but only after its first run. We need a one-time enqueue to start the chain. After that, every sweep schedules the next.

- [ ] **Step 1: Create the bootstrap script**

Create `api/scripts/bootstrap-lease-sweep.ts` with this content:

```typescript
/**
 * One-time bootstrap: enqueue the first lease-sweep Cloud Task. Subsequent
 * sweeps self-reschedule. Safe to re-run — uses a fixed task name and
 * delete-then-create, so it overwrites any pending scheduled sweep.
 *
 * Run: npx tsx scripts/bootstrap-lease-sweep.ts
 *
 * Pre-reqs: GOOGLE_CLOUD_PROJECT, GCP creds, CLOUD_TASKS_LOCATION, CLOUD_TASKS_QUEUE
 * (the same env the API server uses).
 */
import { scheduleLeaseSweep } from '../lib/cloud-tasks';

async function main() {
  if (!process.env.GOOGLE_CLOUD_PROJECT) {
    console.error('GOOGLE_CLOUD_PROJECT not set; nothing to enqueue (LOCAL mode).');
    process.exit(0);
  }
  console.log('Enqueuing first lease-sweep task (12s delay)...');
  await scheduleLeaseSweep();
  console.log('Done. Subsequent sweeps will self-reschedule.');
}

main().catch(err => {
  console.error('Bootstrap failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Add the script to package.json**

In `api/package.json`, add to `scripts`:

```json
    "bootstrap:lease-sweep": "tsx scripts/bootstrap-lease-sweep.ts",
```

- [ ] **Step 3: Run the bootstrap against the deployed environment**

```bash
cd api && GOOGLE_CLOUD_PROJECT=<your-project-id> npm run bootstrap:lease-sweep
```
Expected: `Done. Subsequent sweeps will self-reschedule.`

- [ ] **Step 4: Verify the chain is running by tailing logs**

```bash
gcloud logging read 'resource.type="cloud_run_revision" AND jsonPayload.event="lease-sweep-complete"' --limit=5 --format=json
```
Expected: at least one entry within the next ~30 seconds, with `workersScanned: 0` (no Flutter workers exist yet) and `simsReverted: 0`.

- [ ] **Step 5: Commit**

```bash
git add api/scripts/bootstrap-lease-sweep.ts api/package.json
git commit -m "chore(api): add bootstrap script for first lease-sweep enqueue"
```

---

## Task 10: Document the new endpoint and fields

**Files:**
- Modify: `DATA_FLOW.md`

- [ ] **Step 1: Find the existing "Stale-job recovery" section**

Run: `grep -n "stale" DATA_FLOW.md | head -20`
Expected: shows the existing recovery documentation lines.

- [ ] **Step 2: Add a new section after stale-job recovery**

Insert this section into `DATA_FLOW.md` immediately after the existing stale-job-recovery section:

```markdown
## Lease-based crash recovery (Flutter workers)

Flutter desktop workers (introduced 2026) write a short-lived lease to their `workers/{id}` doc instead of relying solely on the 60-second heartbeat. The lease has two fields:

- `lease.expiresAt`: ISO timestamp set to `now + 15s`, refreshed every 5 seconds by the worker.
- `lease.activeSimIds`: array of `${jobId}:${simId}` composite IDs for sims the worker currently holds RUNNING.

A Cloud Task hits `POST /api/admin/sweep-leases` every ~12 seconds. The handler:
1. Queries `workers where lease.expiresAt < now` (Docker workers without a `lease` field are automatically excluded).
2. For each expired worker, transactionally reverts each `activeSimIds` entry: if the sim is still `RUNNING` and still owned by that workerId, flip to `PENDING`, clear the workerId, set `revertReason = 'lease-expired'`.
3. Marks the worker `status = 'crashed'` and clears the lease.
4. Self-reschedules the next sweep via Cloud Tasks.

Worst-case detection time: 15s (lease) + 12s (sweep cadence) = **~27 seconds** from worker disappearance to sims being available for re-claim. The existing 60s heartbeat / 120s TTL recovery and the 15-minute stale-sweeper remain in place as catch-alls.

To bootstrap the sweep chain after a fresh deployment, run `npm run bootstrap:lease-sweep --prefix api` once. The chain is self-sustaining after that.
```

- [ ] **Step 3: Commit**

```bash
git add DATA_FLOW.md
git commit -m "docs: document lease-based crash recovery in DATA_FLOW.md"
```

---

## Self-review checklist (run before declaring complete)

- [ ] All 10 tasks committed; `git log --oneline -10` shows them in order.
- [ ] `npm run test:unit --prefix api` passes (all existing tests + new lease-sweep unit tests).
- [ ] `npm run test:lease --prefix api` passes against a live dev server with Firestore.
- [ ] `npm run lint --prefix api` passes with no warnings.
- [ ] Bootstrap was run once; `gcloud logging read` shows recurring `lease-sweep-complete` entries every ~12 seconds.
- [ ] No Docker workers were affected: `gcloud logging read` lease-sweep entries all show `workersScanned: 0` (no Flutter workers exist yet).

## What this enables for Plan 2

When the Flutter worker (Plan 2) starts writing `lease.expiresAt` and `lease.activeSimIds` to its `workers/{id}` doc, this sweep activates automatically. No further backend changes are required for the lease-recovery path. Plan 2 only needs to:

- Write `workerType: 'flutter'` on registration
- Write `lease.expiresAt = now + 15s` every 5 seconds via a Dart `Timer.periodic`
- Maintain `lease.activeSimIds` as the Dart-side active set changes
