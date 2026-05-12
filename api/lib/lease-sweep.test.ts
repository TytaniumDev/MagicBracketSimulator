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

  // ── Summary ───────────────────────────────────────────────
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests();
