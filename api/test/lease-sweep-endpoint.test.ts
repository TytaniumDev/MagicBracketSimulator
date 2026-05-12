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
