/**
 * Tests for claimNextSim (SQLite): atomic per-sim claim used by the worker's
 * polling loop. Each test creates a fresh job and cleans up after itself.
 *
 * Run with: npx tsx lib/claim-sim.test.ts
 */

import {
  createJob,
  initializeSimulations,
  getJob,
  getSimulationStatus,
  claimNextSim,
  setJobFailed,
  deleteSimulations,
  deleteJob,
  extendSimLease,
  conditionalUpdateSimulationStatus,
} from './job-store';
import { getDb } from './db';
import type { DeckSlot } from './types';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

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

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const DECKS: DeckSlot[] = [
  { name: 'Deck A', dck: 'a' },
  { name: 'Deck B', dck: 'b' },
  { name: 'Deck C', dck: 'c' },
  { name: 'Deck D', dck: 'd' },
];

/** Pretend the sim's lease ran out a minute ago. */
function expireLease(jobId: string, simId: string) {
  getDb()
    .prepare('UPDATE simulations SET lease_expires_at = ? WHERE job_id = ? AND sim_id = ?')
    .run(new Date(Date.now() - 60_000).toISOString(), jobId, simId);
}

function cleanup(jobId: string) {
  deleteSimulations(jobId);
  deleteJob(jobId);
}

async function runTests() {
  console.log('Running claim-sim tests...\n');

  await test('claims oldest PENDING sim of a QUEUED job', () => {
    const jobId = createJob(DECKS, 8).id;
    try {
      initializeSimulations(jobId, 2);
      const claimed = claimNextSim('worker-1', 'Worker 1');
      assertEqual(claimed?.jobId, jobId, 'claimed jobId');
      assertEqual(claimed?.simId, 'sim_000', 'lowest-index sim first');
      assertEqual(claimed?.simIndex, 0, 'simIndex');
    } finally {
      cleanup(jobId);
    }
  });

  await test('sequential claims advance to next PENDING sim', () => {
    const jobId = createJob(DECKS, 8).id;
    try {
      initializeSimulations(jobId, 2);
      claimNextSim('w', 'W');
      const second = claimNextSim('w', 'W');
      assertEqual(second?.simId, 'sim_001', 'second claim hits next sim');
      const third = claimNextSim('w', 'W');
      assertEqual(third, undefined, 'no more PENDING sims → undefined');
    } finally {
      cleanup(jobId);
    }
  });

  await test('first claim flips job QUEUED → RUNNING with workerId', () => {
    const jobId = createJob(DECKS, 4).id;
    try {
      initializeSimulations(jobId, 1);
      assertEqual(getJob(jobId)!.status, 'QUEUED', 'precondition: QUEUED');
      claimNextSim('worker-x', 'Worker X');
      const after = getJob(jobId);
      assertEqual(after!.status, 'RUNNING', 'job flipped to RUNNING');
      assertEqual(after!.workerId, 'worker-x', 'workerId set on job');
      assertEqual(after!.workerName, 'Worker X', 'workerName set on job');
    } finally {
      cleanup(jobId);
    }
  });

  await test('sim gets state=RUNNING + workerId + startedAt', () => {
    const jobId = createJob(DECKS, 4).id;
    try {
      initializeSimulations(jobId, 1);
      claimNextSim('worker-y', 'Worker Y');
      const sim = getSimulationStatus(jobId, 'sim_000');
      assertEqual(sim!.state, 'RUNNING', 'state');
      assertEqual(sim!.workerId, 'worker-y', 'workerId');
      assertEqual(sim!.workerName, 'Worker Y', 'workerName');
      if (!sim!.startedAt) throw new Error('startedAt should be set');
    } finally {
      cleanup(jobId);
    }
  });

  await test('returns null when no active jobs have PENDING sims', () => {
    const jobId = createJob(DECKS, 4).id;
    try {
      initializeSimulations(jobId, 1);
      setJobFailed(jobId, 'manual');
      const claimed = claimNextSim('w', 'W');
      assertEqual(claimed, undefined, 'FAILED job → no claim');
    } finally {
      cleanup(jobId);
    }
  });

  await test('claims across jobs in creation order', async () => {
    const jobA = createJob(DECKS, 4).id;
    await new Promise((r) => setTimeout(r, 5)); // ensure distinct created_at
    const jobB = createJob(DECKS, 4).id;
    try {
      initializeSimulations(jobA, 1);
      initializeSimulations(jobB, 1);
      const first = claimNextSim('w', 'W');
      assertEqual(first?.jobId, jobA, 'oldest job claimed first');
      const second = claimNextSim('w', 'W');
      assertEqual(second?.jobId, jobB, 'next oldest job claimed second');
    } finally {
      cleanup(jobA);
      cleanup(jobB);
    }
  });

  await test('skips jobs where source is flutter-local', () => {
    const jobId = createJob(DECKS, 4, undefined, undefined, undefined, 'flutter-local').id;
    try {
      initializeSimulations(jobId, 1);
      const claimed = claimNextSim('w', 'W');
      assertEqual(claimed, undefined, 'flutter-local job → no claim');
    } finally {
      cleanup(jobId);
    }
  });

  await test('claim with lease sets leaseExpiresAt about 3 minutes out', () => {
    const jobId = createJob(DECKS, 4).id;
    try {
      initializeSimulations(jobId, 1);
      claimNextSim('w', 'W', { withLease: true });
      const sim = getSimulationStatus(jobId, 'sim_000');
      const msLeft = Date.parse(sim!.leaseExpiresAt ?? '') - Date.now();
      if (!(msLeft > 2.5 * 60_000 && msLeft <= 3 * 60_000)) {
        throw new Error(`lease should expire in ~3 min, got ${msLeft}ms`);
      }
    } finally {
      cleanup(jobId);
    }
  });

  await test('claim without lease leaves leaseExpiresAt unset', () => {
    const jobId = createJob(DECKS, 4).id;
    try {
      initializeSimulations(jobId, 1);
      claimNextSim('w', 'W');
      assertEqual(getSimulationStatus(jobId, 'sim_000')!.leaseExpiresAt, undefined, 'no lease');
    } finally {
      cleanup(jobId);
    }
  });

  await test('RUNNING sim with a live lease is not claimable', () => {
    const jobId = createJob(DECKS, 4).id;
    try {
      initializeSimulations(jobId, 1);
      claimNextSim('w1', 'W1', { withLease: true });
      assertEqual(claimNextSim('w2', 'W2', { withLease: true }), undefined, 'still held by w1');
    } finally {
      cleanup(jobId);
    }
  });

  await test('RUNNING sim with an expired lease is taken over', () => {
    const jobId = createJob(DECKS, 4).id;
    try {
      initializeSimulations(jobId, 1);
      claimNextSim('w1', 'W1', { withLease: true });
      expireLease(jobId, 'sim_000');
      const claimed = claimNextSim('w2', 'W2', { withLease: true });
      assertEqual(claimed?.simId, 'sim_000', 'expired sim reclaimed');
      const sim = getSimulationStatus(jobId, 'sim_000');
      assertEqual(sim!.workerId, 'w2', 'new owner');
      if (Date.parse(sim!.leaseExpiresAt ?? '') <= Date.now()) throw new Error('lease should be fresh');
    } finally {
      cleanup(jobId);
    }
  });

  await test('extendSimLease extends for the owner', () => {
    const jobId = createJob(DECKS, 4).id;
    try {
      initializeSimulations(jobId, 1);
      claimNextSim('w1', 'W1', { withLease: true });
      expireLease(jobId, 'sim_000');
      assertEqual(extendSimLease(jobId, 'sim_000', 'w1'), 'extended', 'status');
      if (Date.parse(getSimulationStatus(jobId, 'sim_000')!.leaseExpiresAt ?? '') <= Date.now()) {
        throw new Error('lease should be pushed into the future');
      }
    } finally {
      cleanup(jobId);
    }
  });

  await test('extendSimLease reports lost for another worker or a finished sim', () => {
    const jobId = createJob(DECKS, 4).id;
    try {
      initializeSimulations(jobId, 1);
      claimNextSim('w1', 'W1', { withLease: true });
      assertEqual(extendSimLease(jobId, 'sim_000', 'w2'), 'lost', 'other worker');
      conditionalUpdateSimulationStatus(jobId, 'sim_000', ['RUNNING'], { state: 'COMPLETED' });
      assertEqual(extendSimLease(jobId, 'sim_000', 'w1'), 'lost', 'finished sim');
      assertEqual(extendSimLease(jobId, 'sim_404', 'w1'), 'lost', 'missing sim');
    } finally {
      cleanup(jobId);
    }
  });

  await test('extendSimLease reports cancelled for a cancelled sim', () => {
    const jobId = createJob(DECKS, 4).id;
    try {
      initializeSimulations(jobId, 1);
      claimNextSim('w1', 'W1', { withLease: true });
      conditionalUpdateSimulationStatus(jobId, 'sim_000', ['RUNNING'], { state: 'CANCELLED' });
      assertEqual(extendSimLease(jobId, 'sim_000', 'w1'), 'cancelled', 'status');
    } finally {
      cleanup(jobId);
    }
  });

  console.log('\n-------------------');
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
