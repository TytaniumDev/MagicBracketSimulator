import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  getNextQueuedJob,
  updateJobStatus,
  setJobResult,
  setJobFailed,
} from '../lib/job-store';
import { withRetry } from '../lib/retry';
import { AnalysisResult } from '../lib/types';

const POLL_INTERVAL_MS = 3000; // 3 seconds
const FORGE_ENGINE_PATH = process.env.FORGE_ENGINE_PATH || '../forge-simulation-engine';
const ANALYSIS_SERVICE_URL = process.env.ANALYSIS_SERVICE_URL || 'http://localhost:8000';
const JOBS_DIR = path.resolve(__dirname, '..', 'jobs');

// Ensure jobs directory exists
if (!fs.existsSync(JOBS_DIR)) {
  fs.mkdirSync(JOBS_DIR, { recursive: true });
}

async function processJob(job: ReturnType<typeof getNextQueuedJob>) {
  if (!job) return;

  console.log(`[Worker] Processing job ${job.id}: ${job.deckName}`);
  console.log(`[Worker] Opponents: ${job.opponents.join(', ')}`);
  console.log(`[Worker] Simulations: ${job.simulations}`);

  // Update status to RUNNING
  updateJobStatus(job.id, 'RUNNING');

  // Create job directory structure
  const jobDir = path.join(JOBS_DIR, job.id);
  const decksDir = path.join(jobDir, 'decks');
  const logsDir = path.join(jobDir, 'logs');

  try {
    // Create directories
    fs.mkdirSync(decksDir, { recursive: true });
    fs.mkdirSync(logsDir, { recursive: true });

    // Write deck file
    const deckFilename = 'deck.dck';
    fs.writeFileSync(path.join(decksDir, deckFilename), job.deckDck);

    // Run Docker with retry (non-zero exit or no logs)
    console.log(`[Worker] Spawning Docker container...`);
    const gameLogs = await withRetry(
      async () => {
        const exitCode = await runForgeDocker(
          job.id,
          deckFilename,
          job.opponents,
          job.simulations,
          decksDir,
          logsDir
        );
        if (exitCode !== 0) {
          throw new Error(`Forge simulation failed with exit code ${exitCode}`);
        }
        const logs = readGameLogs(logsDir, job.id);
        if (logs.length === 0) {
          throw new Error('No game logs produced by simulation');
        }
        return logs;
      },
      {},
      'Forge exit or no game logs'
    );

    console.log(`[Worker] Found ${gameLogs.length} game logs`);

    // Update status to ANALYZING
    updateJobStatus(job.id, 'ANALYZING');

    // Call Analysis Service with retry (network / 5xx only; no retry on 4xx)
    console.log(`[Worker] Calling Analysis Service...`);
    const analysisResult = await withRetry(
      () => callAnalysisService(job.deckName, job.opponents, gameLogs),
      {},
      'Analysis Service error',
      (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        return !/Analysis Service error: 4\d\d/.test(msg);
      }
    );

    // Save result
    setJobResult(job.id, analysisResult);
    console.log(`[Worker] Job ${job.id} completed. Bracket: ${analysisResult.bracket}`);

    // Cleanup (optional - keep for debugging)
    // fs.rmSync(jobDir, { recursive: true, force: true });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Worker] Job ${job.id} failed:`, message);
    setJobFailed(job.id, message);
  }
}

async function runForgeDocker(
  jobId: string,
  deckFilename: string,
  opponents: string[],
  simulations: number,
  decksDir: string,
  logsDir: string
): Promise<number> {
  return new Promise((resolve, reject) => {
    // Determine if running on Windows with Git Bash
    const isWindows = process.platform === 'win32';
    const env = { ...process.env };
    
    if (isWindows) {
      // Prevent MSYS path conversion issues
      env.MSYS_NO_PATHCONV = '1';
    }

    const dockerArgs = [
      'run',
      '--rm',
      '-v', `${decksDir}:/app/decks`,
      '-v', `${logsDir}:/app/logs`,
      'forge-sim',
      '--user-deck', deckFilename,
      '--opponents', opponents[0], opponents[1], opponents[2],
      '--simulations', simulations.toString(),
      '--id', `job_${jobId}`,
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
      if (code !== 0) {
        console.error(`[Worker] Docker stderr:`, stderr || '(empty)');
        console.log(`[Worker] Docker stdout:`, stdout || '(empty)');
      }
      resolve(code ?? 1);
    });

    dockerProcess.on('error', (error) => {
      console.error(`[Worker] Failed to spawn Docker:`, error);
      reject(error);
    });
  });
}

function readGameLogs(logsDir: string, jobId: string): string[] {
  const logs: string[] = [];
  
  try {
    const files = fs.readdirSync(logsDir);
    const logFiles = files
      .filter(f => f.startsWith(`job_${jobId}_game_`) && f.endsWith('.txt'))
      .sort();

    for (const file of logFiles) {
      const content = fs.readFileSync(path.join(logsDir, file), 'utf-8');
      if (content.trim()) {
        logs.push(content);
      }
    }
  } catch (error) {
    console.error(`[Worker] Error reading logs:`, error);
  }

  return logs;
}

async function callAnalysisService(
  heroDeckName: string,
  opponents: string[],
  gameLogs: string[]
): Promise<AnalysisResult> {
  const url = `${ANALYSIS_SERVICE_URL}/analyze`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      hero_deck_name: heroDeckName,
      opponent_decks: opponents,
      game_logs: gameLogs,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Analysis Service error: ${response.status} ${text}`);
  }

  const result = await response.json();

  return {
    bracket: result.bracket,
    confidence: result.confidence,
    reasoning: result.reasoning,
    weaknesses: result.weaknesses,
  };
}

async function runWorkerLoop() {
  console.log('[Worker] Starting worker loop...');
  console.log(`[Worker] FORGE_ENGINE_PATH: ${FORGE_ENGINE_PATH}`);
  console.log(`[Worker] ANALYSIS_SERVICE_URL: ${ANALYSIS_SERVICE_URL}`);
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
