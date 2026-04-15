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
} from './job-store';
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
