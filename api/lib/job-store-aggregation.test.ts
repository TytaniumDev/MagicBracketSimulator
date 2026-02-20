/**
 * Tests for aggregateJobResults (job-store-factory.ts).
 *
 * Uses real SQLite + real filesystem. Sets LOGS_DATA_DIR to a temp dir.
 * Uses the job-store directly for SQLite operations.
 *
 * IMPORTANT: All imports of log-store and job-store-factory are dynamic
 * (inside runTests) so LOGS_DATA_DIR is set before module initialization.
 *
 * Run with: npx tsx lib/job-store-aggregation.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ---------------------------------------------------------------------------
// Test Utilities
// ---------------------------------------------------------------------------

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

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function runTests() {
  console.log('Running job-store-aggregation tests...\n');

  // Set LOGS_DATA_DIR BEFORE any module that reads it is loaded
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aggregation-test-'));
  process.env.LOGS_DATA_DIR = tempDir;

  // Dynamic imports so LOGS_DATA_DIR is set before module init
  const { splitConcatenatedGames } = await import('./condenser/index');
  const jobStore = await import('./job-store');
  const { aggregateJobResults } = await import('./job-store-factory');
  const logStore = await import('./log-store');

  type DeckSlot = import('./types').DeckSlot;

  const DECKS: DeckSlot[] = [
    { name: 'Deck A', dck: 'a' },
    { name: 'Deck B', dck: 'b' },
    { name: 'Deck C', dck: 'c' },
    { name: 'Deck D', dck: 'd' },
  ];

  const FIXTURE_PATH = path.join(__dirname, 'condenser', 'fixtures', 'real-4game-log.txt');
  const rawFixture = fs.readFileSync(FIXTURE_PATH, 'utf-8');
  const individualGames = splitConcatenatedGames(rawFixture);

  function createTestJob(simCount: number = 2): string {
    const job = jobStore.createJob(DECKS, simCount * 4);
    return job.id;
  }

  function cleanup(jobId: string) {
    jobStore.deleteSimulations(jobId);
    jobStore.deleteJob(jobId);
    const jobDir = path.join(tempDir, jobId);
    if (fs.existsSync(jobDir)) {
      fs.rmSync(jobDir, { recursive: true, force: true });
    }
  }

  async function uploadRawLogs(jobId: string, gameCount: number) {
    for (let i = 0; i < gameCount; i++) {
      const game = individualGames[i % individualGames.length];
      const filename = `raw/game_${String(i + 1).padStart(3, '0')}.txt`;
      await logStore.uploadSingleSimulationLog(jobId, filename, game);
    }
  }

  try {
    // =========================================================================
    // Guard conditions
    // =========================================================================

    await test('returns immediately when no simulations exist', async () => {
      const jobId = createTestJob();
      try {
        jobStore.updateJobStatus(jobId, 'RUNNING');
        await aggregateJobResults(jobId);
        const job = jobStore.getJob(jobId);
        assertEqual(job!.status, 'RUNNING', 'status should remain RUNNING');
      } finally {
        cleanup(jobId);
      }
    });

    await test('returns immediately when some sims still RUNNING', async () => {
      const jobId = createTestJob(2);
      try {
        jobStore.updateJobStatus(jobId, 'RUNNING');
        jobStore.initializeSimulations(jobId, 2);
        jobStore.updateSimulationStatus(jobId, 'sim_000', { state: 'COMPLETED' });
        jobStore.updateSimulationStatus(jobId, 'sim_001', { state: 'RUNNING' });
        await aggregateJobResults(jobId);
        const job = jobStore.getJob(jobId);
        assertEqual(job!.status, 'RUNNING', 'status should remain RUNNING (sims not all done)');
      } finally {
        cleanup(jobId);
      }
    });

    await test('returns immediately when job already COMPLETED (idempotency)', async () => {
      const jobId = createTestJob(1);
      try {
        jobStore.updateJobStatus(jobId, 'RUNNING');
        jobStore.initializeSimulations(jobId, 1);
        jobStore.updateSimulationStatus(jobId, 'sim_000', { state: 'COMPLETED' });
        jobStore.setJobCompleted(jobId);
        const beforeJob = jobStore.getJob(jobId);
        assertEqual(beforeJob!.status, 'COMPLETED', 'pre-condition: job should be COMPLETED');
        await aggregateJobResults(jobId);
        const afterJob = jobStore.getJob(jobId);
        assertEqual(afterJob!.status, 'COMPLETED', 'status should still be COMPLETED');
      } finally {
        cleanup(jobId);
      }
    });

    // =========================================================================
    // Main flow
    // =========================================================================

    await test('all sims COMPLETED with uploaded raw logs → job COMPLETED + artifacts', async () => {
      const jobId = createTestJob(1);
      try {
        jobStore.updateJobStatus(jobId, 'RUNNING');
        jobStore.initializeSimulations(jobId, 1);
        jobStore.updateSimulationStatus(jobId, 'sim_000', { state: 'COMPLETED' });
        await uploadRawLogs(jobId, 4);
        await aggregateJobResults(jobId);
        const job = jobStore.getJob(jobId);
        assertEqual(job!.status, 'COMPLETED', 'job should be COMPLETED');
        const metaPath = path.join(tempDir, jobId, 'meta.json');
        assert(fs.existsSync(metaPath), 'meta.json should exist');
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        assert(Array.isArray(meta.condensed), 'should have condensed');
        assert(Array.isArray(meta.structured), 'should have structured');
      } finally {
        cleanup(jobId);
      }
    });

    await test('CANCELLED job with completed sims → logs ingested but status stays CANCELLED', async () => {
      const jobId = createTestJob(2);
      try {
        jobStore.updateJobStatus(jobId, 'RUNNING');
        jobStore.initializeSimulations(jobId, 2);
        jobStore.updateSimulationStatus(jobId, 'sim_000', { state: 'COMPLETED' });
        jobStore.cancelJob(jobId);
        await uploadRawLogs(jobId, 4);
        await aggregateJobResults(jobId);
        const job = jobStore.getJob(jobId);
        assertEqual(job!.status, 'CANCELLED', 'status should remain CANCELLED');
        const metaPath = path.join(tempDir, jobId, 'meta.json');
        assert(fs.existsSync(metaPath), 'meta.json should exist (logs ingested for CANCELLED job)');
      } finally {
        cleanup(jobId);
      }
    });

    await test('all sims CANCELLED with no raw logs → no error, no artifacts', async () => {
      const jobId = createTestJob(1);
      try {
        jobStore.updateJobStatus(jobId, 'RUNNING');
        jobStore.initializeSimulations(jobId, 1);
        jobStore.updateSimulationStatus(jobId, 'sim_000', { state: 'CANCELLED' });
        jobStore.updateJobStatus(jobId, 'CANCELLED');
        await aggregateJobResults(jobId);
        const metaPath = path.join(tempDir, jobId, 'meta.json');
        assert(!fs.existsSync(metaPath), 'meta.json should not exist when no raw logs');
      } finally {
        cleanup(jobId);
      }
    });

    await test('idempotent: second call after COMPLETED is a no-op', async () => {
      const jobId = createTestJob(1);
      try {
        jobStore.updateJobStatus(jobId, 'RUNNING');
        jobStore.initializeSimulations(jobId, 1);
        jobStore.updateSimulationStatus(jobId, 'sim_000', { state: 'COMPLETED' });
        await uploadRawLogs(jobId, 4);
        await aggregateJobResults(jobId);
        const job1 = jobStore.getJob(jobId);
        assertEqual(job1!.status, 'COMPLETED', 'should be COMPLETED after first call');
        await aggregateJobResults(jobId);
        const job2 = jobStore.getJob(jobId);
        assertEqual(job2!.status, 'COMPLETED', 'should still be COMPLETED after second call');
      } finally {
        cleanup(jobId);
      }
    });

    await test('partial completion: some COMPLETED + some CANCELLED → aggregates available logs', async () => {
      const jobId = createTestJob(2);
      try {
        jobStore.updateJobStatus(jobId, 'RUNNING');
        jobStore.initializeSimulations(jobId, 2);
        jobStore.updateSimulationStatus(jobId, 'sim_000', { state: 'COMPLETED' });
        jobStore.updateSimulationStatus(jobId, 'sim_001', { state: 'CANCELLED' });
        await uploadRawLogs(jobId, 4);
        await aggregateJobResults(jobId);
        const job = jobStore.getJob(jobId);
        assertEqual(job!.status, 'COMPLETED', 'should be COMPLETED (partial)');
        const metaPath = path.join(tempDir, jobId, 'meta.json');
        assert(fs.existsSync(metaPath), 'meta.json should exist with partial logs');
      } finally {
        cleanup(jobId);
      }
    });

    // =========================================================================
    // FAILED sims are not terminal
    // =========================================================================

    await test('FAILED sims prevent aggregation (not terminal)', async () => {
      const jobId = createTestJob(2);
      try {
        jobStore.updateJobStatus(jobId, 'RUNNING');
        jobStore.initializeSimulations(jobId, 2);
        jobStore.updateSimulationStatus(jobId, 'sim_000', { state: 'COMPLETED' });
        jobStore.updateSimulationStatus(jobId, 'sim_001', { state: 'FAILED', errorMessage: 'timeout' });
        await aggregateJobResults(jobId);
        const job = jobStore.getJob(jobId);
        assertEqual(job!.status, 'RUNNING', 'should remain RUNNING when FAILED sims exist');
      } finally {
        cleanup(jobId);
      }
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  // =========================================================================
  // Summary
  // =========================================================================

  console.log('\n--- Test Summary ---');
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`Passed: ${passed}/${results.length}`);
  console.log(`Failed: ${failed}/${results.length}`);

  if (failed > 0) {
    console.log('\nFailed tests:');
    results
      .filter((r) => !r.passed)
      .forEach((r) => {
        console.log(`  - ${r.name}: ${r.error}`);
      });
    process.exit(1);
  }

  console.log('\nAll tests passed!');
}

runTests().catch((error) => {
  console.error('Test runner error:', error);
  process.exit(1);
});
