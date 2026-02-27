/**
 * Cancel and recover flow tests.
 *
 * Tests the cancel and recovery paths through the job store factory.
 * Currently runs against SQLite (LOCAL mode).
 *
 * Run with: npx tsx test/cancel-recover.test.ts
 */

import * as jobStore from '../lib/job-store-factory';
import type { DeckSlot } from '../lib/types';

// ---------------------------------------------------------------------------
// Test Utilities (same pattern as job-store-contract.test.ts)
// ---------------------------------------------------------------------------

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

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const TEST_DECKS: DeckSlot[] = [
  { name: 'Cancel Test A', dck: 'deck_a' },
  { name: 'Cancel Test B', dck: 'deck_b' },
  { name: 'Cancel Test C', dck: 'deck_c' },
  { name: 'Cancel Test D', dck: 'deck_d' },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function runTests() {
  console.log('Running cancel/recover tests...\n');

  // ── Cancel QUEUED job ────────────────────────────────────────────────

  await test('cancelJob: cancels a QUEUED job', async () => {
    const job = await jobStore.createJob(TEST_DECKS, 8);
    const result = await jobStore.cancelJob(job.id);
    assertEqual(result, true, 'should succeed');
    const updated = await jobStore.getJob(job.id);
    assertEqual(updated!.status, 'CANCELLED', 'status should be CANCELLED');
    assert(updated!.completedAt instanceof Date, 'completedAt should be set');
    await jobStore.deleteJob(job.id);
  });

  // ── Cancel RUNNING job ───────────────────────────────────────────────

  await test('cancelJob: cancels a RUNNING job and cancels its sims', async () => {
    const job = await jobStore.createJob(TEST_DECKS, 8);
    // Transition to RUNNING
    await jobStore.updateJobStatus(job.id, 'RUNNING');
    await jobStore.setJobStartedAt(job.id, 'worker-1', 'Worker 1');
    // Initialize sims
    await jobStore.initializeSimulations(job.id, 2);
    // Set one sim to RUNNING
    await jobStore.updateSimulationStatus(job.id, 'sim_000', { state: 'RUNNING' });

    const result = await jobStore.cancelJob(job.id);
    assertEqual(result, true, 'should succeed');

    const updated = await jobStore.getJob(job.id);
    assertEqual(updated!.status, 'CANCELLED', 'job status should be CANCELLED');

    // Check sims were cancelled
    const sims = await jobStore.getSimulationStatuses(job.id);
    for (const sim of sims) {
      assertEqual(sim.state, 'CANCELLED', `sim ${sim.simId} should be CANCELLED`);
    }

    await jobStore.deleteSimulations(job.id);
    await jobStore.deleteJob(job.id);
  });

  // ── Cancel terminal job (rejected) ───────────────────────────────────

  await test('cancelJob: rejects cancel on COMPLETED job', async () => {
    const job = await jobStore.createJob(TEST_DECKS, 8);
    await jobStore.setJobCompleted(job.id);
    const result = await jobStore.cancelJob(job.id);
    assertEqual(result, false, 'should reject');
    const updated = await jobStore.getJob(job.id);
    assertEqual(updated!.status, 'COMPLETED', 'status should still be COMPLETED');
    await jobStore.deleteJob(job.id);
  });

  await test('cancelJob: rejects cancel on FAILED job', async () => {
    const job = await jobStore.createJob(TEST_DECKS, 8);
    await jobStore.updateJobStatus(job.id, 'RUNNING');
    await jobStore.setJobFailed(job.id, 'test error');
    const result = await jobStore.cancelJob(job.id);
    assertEqual(result, false, 'should reject');
    await jobStore.deleteJob(job.id);
  });

  await test('cancelJob: rejects cancel on already CANCELLED job', async () => {
    const job = await jobStore.createJob(TEST_DECKS, 8);
    await jobStore.cancelJob(job.id); // First cancel
    const result = await jobStore.cancelJob(job.id); // Second cancel
    assertEqual(result, false, 'should reject second cancel');
    await jobStore.deleteJob(job.id);
  });

  // ── Cancel nonexistent job ───────────────────────────────────────────

  await test('cancelJob: returns false for nonexistent job', async () => {
    const result = await jobStore.cancelJob('nonexistent-cancel-test');
    assertEqual(result, false, 'should return false');
  });

  // ── Recovery no-ops on terminal jobs ─────────────────────────────────

  await test('recoverStaleJob: no-ops on COMPLETED job', async () => {
    const job = await jobStore.createJob(TEST_DECKS, 8);
    await jobStore.setJobCompleted(job.id);
    const result = await jobStore.recoverStaleJob(job.id);
    assertEqual(result, false, 'should not recover terminal job');
    await jobStore.deleteJob(job.id);
  });

  await test('recoverStaleJob: no-ops on FAILED job', async () => {
    const job = await jobStore.createJob(TEST_DECKS, 8);
    await jobStore.updateJobStatus(job.id, 'RUNNING');
    await jobStore.setJobFailed(job.id, 'test error');
    const result = await jobStore.recoverStaleJob(job.id);
    assertEqual(result, false, 'should not recover terminal job');
    await jobStore.deleteJob(job.id);
  });

  await test('recoverStaleJob: no-ops on CANCELLED job', async () => {
    const job = await jobStore.createJob(TEST_DECKS, 8);
    await jobStore.cancelJob(job.id);
    const result = await jobStore.recoverStaleJob(job.id);
    assertEqual(result, false, 'should not recover terminal job');
    await jobStore.deleteJob(job.id);
  });

  await test('recoverStaleJob: returns false for nonexistent job', async () => {
    const result = await jobStore.recoverStaleJob('nonexistent-recover-test');
    assertEqual(result, false, 'should return false');
  });

  // ── Idempotency key ──────────────────────────────────────────────────

  await test('createJob: idempotency key returns same job', async () => {
    const job1 = await jobStore.createJob(TEST_DECKS, 8, { idempotencyKey: 'test-idempotency-key-cancel' });
    const job2 = await jobStore.createJob(TEST_DECKS, 8, { idempotencyKey: 'test-idempotency-key-cancel' });
    assertEqual(job1.id, job2.id, 'should return same job ID');
    await jobStore.deleteJob(job1.id);
  });

  // ── Summary ──────────────────────────────────────────────────────────

  console.log('\n--- Test Summary ---');
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`Passed: ${passed}/${results.length}`);
  console.log(`Failed: ${failed}/${results.length}`);

  if (failed > 0) {
    console.log('\nFailed tests:');
    results.filter(r => !r.passed).forEach(r => console.log(`  - ${r.name}: ${r.error}`));
    process.exit(1);
  }
  console.log('\nAll tests passed!');
}

runTests().catch(err => { console.error('Test runner error:', err); process.exit(1); });
