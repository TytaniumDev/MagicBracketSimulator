import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  getNextQueuedJob,
  updateJobStatus,
  updateJobProgress,
  setJobStartedAt,
  setJobCompleted,
  setJobFailed,
} from '../lib/job-store';
import { withRetry } from '../lib/retry';
import { countGameLogFiles, readGameLogs } from '../lib/game-logs';

const POLL_INTERVAL_MS = 3000; // 3 seconds
const FORGE_ENGINE_PATH = process.env.FORGE_ENGINE_PATH || '../forge-simulation-engine';
const LOG_ANALYZER_URL = process.env.LOG_ANALYZER_URL || 'http://localhost:3001';
const DEFAULT_PARALLELISM = 4;
const JOBS_DIR = path.resolve(__dirname, '..', 'jobs');

function splitSimulations(total: number, parallelism: number): number[] {
  const runs = Math.min(parallelism, total);
  const base = Math.floor(total / runs);
  const remainder = total % runs;
  return Array.from({ length: runs }, (_, i) => base + (i < remainder ? 1 : 0));
}

// Ensure jobs directory exists
if (!fs.existsSync(JOBS_DIR)) {
  fs.mkdirSync(JOBS_DIR, { recursive: true });
}

async function processJob(job: ReturnType<typeof getNextQueuedJob>) {
  if (!job) return;

  const parallelism = job.parallelism ?? (Number(process.env.FORGE_PARALLELISM) || DEFAULT_PARALLELISM);
  const runConfigs = splitSimulations(job.simulations, parallelism);

  const deckNames = job.decks.map((d) => d.name);
  console.log(`[Worker] Processing job ${job.id}: ${deckNames.join(' vs ')}`);
  console.log(`[Worker] Simulations: ${job.simulations}, parallel runs: ${runConfigs.length} (${runConfigs.join(', ')})`);

  // Update status to RUNNING and record start time
  updateJobStatus(job.id, 'RUNNING');
  setJobStartedAt(job.id);

  // Create job directory structure
  const jobDir = path.join(JOBS_DIR, job.id);
  const decksDir = path.join(jobDir, 'decks');
  const logsDir = path.join(jobDir, 'logs');

  // Progress tracking interval
  let progressInterval: ReturnType<typeof setInterval> | null = null;
  let dockerRunDurationsMs: number[] = [];

  try {
    // Create directories (make writable by Docker container's forge user on Linux/WSL)
    fs.mkdirSync(decksDir, { recursive: true });
    fs.mkdirSync(logsDir, { recursive: true });
    try {
      fs.chmodSync(decksDir, 0o777);
      fs.chmodSync(logsDir, 0o777);
    } catch {
      // Ignore chmod errors (e.g. Windows)
    }

    // Write all 4 deck files
    const deckFilenames: string[] = [];
    for (let i = 0; i < job.decks.length; i++) {
      const filename = `deck_${i}.dck`;
      fs.writeFileSync(path.join(decksDir, filename), job.decks[i].dck);
      deckFilenames.push(filename);
    }

    // Initialize progress to 0
    updateJobProgress(job.id, 0);

    // Start progress tracking interval (every 5 seconds)
    progressInterval = setInterval(() => {
      const count = countGameLogFiles(logsDir, job.id);
      updateJobProgress(job.id, count);
    }, 5000);

    // Run Docker containers in parallel (with retry on failure)
    console.log(`[Worker] Spawning ${runConfigs.length} Docker container(s)...`);
    const gameLogs = await withRetry(
      async () => {
        const results = await Promise.all(
          runConfigs.map((games, runIndex) =>
            runForgeDocker(
              job.id,
              deckFilenames,
              games,
              runConfigs.length > 1 ? runIndex : undefined,
              decksDir,
              logsDir
            )
          )
        );

        dockerRunDurationsMs = results.map((r) => r.durationMs);
        const failed = results.findIndex((r) => r.exitCode !== 0);
        if (failed >= 0) {
          throw new Error(`Forge run ${failed} failed with exit code ${results[failed].exitCode}`);
        }

        const logs = readGameLogs(logsDir, job.id);
        if (logs.length === 0) {
          throw new Error('No game logs produced by simulation');
        }
        if (logs.length < job.simulations) {
          console.warn(`[Worker] Expected ${job.simulations} game logs, got ${logs.length}`);
        }
        return logs;
      },
      {},
      'Forge exit or no game logs'
    );

    // Clear progress interval first so no tick can overwrite the final count
    if (progressInterval) {
      clearInterval(progressInterval);
      progressInterval = null;
    }

    // Set final progress to the intended total (job.simulations). Using gameLogs.length
    // can undercount when multiple parallel runs write to the same dir and the host
    // sees only one file per run (e.g. 8 or 4) due to FS sync timing.
    updateJobProgress(job.id, job.simulations);

    console.log(`[Worker] Found ${gameLogs.length} game logs`);

    // -------------------------------------------------------------------------
    // POST logs to Log Analyzer for storage and later retrieval
    // -------------------------------------------------------------------------
    console.log(`[Worker] Sending logs to Log Analyzer...`);
    // Include all 4 deck lists for AI analysis
    const deckLists = job.decks.map((d) => d.dck);
    await withRetry(
      async () => {
        const response = await fetch(`${LOG_ANALYZER_URL}/jobs/${job.id}/logs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            gameLogs,
            deckNames,
            deckLists,
          }),
        });
        if (!response.ok) {
          throw new Error(`Log Analyzer ingest error: ${response.status}`);
        }
      },
      {},
      'Log Analyzer ingest'
    );
    console.log(`[Worker] Logs sent to Log Analyzer (with deck lists)`);

    // Mark job as completed (analysis is now on-demand via frontend)
    setJobCompleted(job.id, { completedAt: new Date(), dockerRunDurationsMs });
    console.log(`[Worker] Job ${job.id} completed. Simulations done, analysis available on-demand.`);

    // Cleanup (optional - keep for debugging)
    // fs.rmSync(jobDir, { recursive: true, force: true });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Worker] Job ${job.id} failed:`, message);
    setJobFailed(job.id, message, { completedAt: new Date(), dockerRunDurationsMs });
  } finally {
    // Ensure progress interval is cleared even on error
    if (progressInterval) {
      clearInterval(progressInterval);
    }
  }
}

async function runForgeDocker(
  jobId: string,
  deckFilenames: string[],
  simulations: number,
  runIndex: number | undefined,
  decksDir: string,
  logsDir: string
): Promise<{ exitCode: number; durationMs: number }> {
  return new Promise((resolve, reject) => {
    const startMs = Date.now();
    // Determine if running on Windows with Git Bash
    const isWindows = process.platform === 'win32';
    const env = { ...process.env };

    if (isWindows) {
      // Prevent MSYS path conversion issues
      env.MSYS_NO_PATHCONV = '1';
    }

    const runId = runIndex != null ? `job_${jobId}_run${runIndex}` : `job_${jobId}`;

    const dockerArgs = [
      'run',
      '--rm',
      '-v',
      `${decksDir}:/app/decks`,
      '-v',
      `${logsDir}:/app/logs`,
      'forge-sim',
      '--decks',
      deckFilenames[0],
      deckFilenames[1],
      deckFilenames[2],
      deckFilenames[3],
      '--simulations',
      simulations.toString(),
      '--id',
      runId,
    ];

    console.log(`[Worker] Docker command: docker ${dockerArgs.join(' ')}`);

    const dockerProcess = spawn('docker', dockerArgs, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    dockerProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    dockerProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    dockerProcess.on('close', (code) => {
      const durationMs = Date.now() - startMs;
      if (code !== 0) {
        console.error(`[Worker] Docker stderr:`, stderr || '(empty)');
        console.log(`[Worker] Docker stdout:`, stdout || '(empty)');
      }
      resolve({ exitCode: code ?? 1, durationMs });
    });

    dockerProcess.on('error', (error) => {
      console.error(`[Worker] Failed to spawn Docker:`, error);
      reject(error);
    });
  });
}

async function runWorkerLoop() {
  console.log('[Worker] Starting worker loop...');
  console.log(`[Worker] FORGE_ENGINE_PATH: ${FORGE_ENGINE_PATH}`);
  console.log(`[Worker] LOG_ANALYZER_URL: ${LOG_ANALYZER_URL}`);
  console.log(`[Worker] JOBS_DIR: ${JOBS_DIR}`);

  while (true) {
    try {
      const job = getNextQueuedJob();
      
      if (job) {
        await processJob(job);
      } else {
        // No jobs in queue, wait before polling again
        await sleep(POLL_INTERVAL_MS);
      }
    } catch (error) {
      console.error('[Worker] Unexpected error in worker loop:', error);
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Start the worker
runWorkerLoop().catch(error => {
  console.error('[Worker] Fatal error:', error);
  process.exit(1);
});
