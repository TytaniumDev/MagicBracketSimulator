/**
 * Tests for the lease-sweep pure predicate and orchestration.
 * Run with: npx tsx lib/lease-sweep.test.ts
 */
import { isLeaseExpired } from './lease-sweep';
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
