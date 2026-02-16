import 'dotenv/config';
import { execSync } from 'child_process';

// Resolve GCP project from gcloud config if not set (no .env needed)
if (!process.env.GOOGLE_CLOUD_PROJECT) {
  try {
    const out = execSync('gcloud config get-value project --format="value(core.project)"', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const p = (out || '').trim();
    if (p.length > 0) process.env.GOOGLE_CLOUD_PROJECT = p;
  } catch {
    // gcloud not installed or project not set; worker will use env only
  }
}

/**
 * Worker Orchestrator: Manages simulation containers via Docker socket
 *
 * This worker:
 * 1. Loads config from Google Secret Manager (if GOOGLE_CLOUD_PROJECT set) or env
 * 2. Receives jobs via Pub/Sub (if PUBSUB_SUBSCRIPTION set) or polls GET /api/jobs/next
 * 3. Fetches job details from the API
 * 4. Writes deck files to a temp directory per-job
 * 5. Spawns simulation containers (1 per game) with bounded concurrency
 * 6. Reports per-simulation progress to the API
 * 7. Aggregates logs and POSTs to the API
 */

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

import {
  JobData,
  JobCreatedMessage,
  ProcessResult,
} from './types.js';
import {
  splitConcatenatedGames,
} from './condenser.js';

const SECRET_NAME = 'simulation-worker-config';
const WORKER_ID_FILE = 'worker-id';

// Module-scoped worker ID, set in main() after initialization
let currentWorkerId = '';

// ============================================================================
// Configuration
// ============================================================================

const SIMULATION_IMAGE = process.env.SIMULATION_IMAGE || 'magic-bracket-simulation:latest';
const JOBS_DIR = process.env.JOBS_DIR || '/tmp/mbs-jobs';

// Legacy: if FORGE_PATH is set, we're in monolithic mode (backward compat)
const FORGE_PATH = process.env.FORGE_PATH || '';
const USE_CONTAINERS = !FORGE_PATH;

// Forge's commander deck directory (only used in monolithic mode)
const FORGE_COMMANDER_DECKS_DIR = '/home/worker/.forge/decks/commander';

// Reserve ~2GB for system + worker overhead
const SYSTEM_RESERVE_MB = 2048;
// Each Forge sim needs ~500-600MB RAM
const RAM_PER_SIM_MB = 600;

// ============================================================================
// Semaphore (bounded concurrency)
// ============================================================================

class Semaphore {
  private count: number;
  private waiting: (() => void)[] = [];

  constructor(max: number) {
    this.count = max;
  }

  async acquire(): Promise<void> {
    if (this.count > 0) {
      this.count--;
      return;
    }
    return new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  release(): void {
    if (this.waiting.length > 0) {
      const next = this.waiting.shift()!;
      next();
    } else {
      this.count++;
    }
  }
}

// ============================================================================
// Worker ID Management
// ============================================================================

/**
 * Get or create a stable worker ID (survives restarts).
 * Priority: (1) WORKER_ID env, (2) persisted file, (3) generate UUID and persist.
 */
async function getOrCreateWorkerId(jobsDir: string): Promise<string> {
  const fromEnv = process.env.WORKER_ID?.trim();
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv;
  }
  const workerIdPath = path.resolve(jobsDir, '..', WORKER_ID_FILE);
  try {
    const existing = await fs.readFile(workerIdPath, 'utf-8');
    const id = existing.trim();
    if (id.length > 0) return id;
  } catch {
    // File missing or unreadable
  }
  const newId = crypto.randomUUID();
  await fs.mkdir(path.dirname(workerIdPath), { recursive: true }).catch(() => {});
  await fs.writeFile(workerIdPath, newId, 'utf-8');
  return newId;
}

// ============================================================================
// Secret Manager Config
// ============================================================================

/**
 * Load config from Google Secret Manager (if available) and merge into process.env.
 * Existing env vars take precedence. If Secret Manager is not configured or fails, we keep env-only.
 */
async function loadConfigFromSecretManager(): Promise<void> {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT;
  if (!projectId) {
    return;
  }
  try {
    const { SecretManagerServiceClient } = await import('@google-cloud/secret-manager');
    const client = new SecretManagerServiceClient();
    const [version] = await client.accessSecretVersion({
      name: `projects/${projectId}/secrets/${SECRET_NAME}/versions/latest`,
    });
    const payload = version.payload?.data;
    if (!payload) {
      return;
    }
    const data =
      typeof payload === 'string' ? payload : Buffer.from(payload).toString('utf8');
    const config = JSON.parse(data) as Record<string, string>;
    for (const [key, value] of Object.entries(config)) {
      const current = process.env[key];
      const unset = current === undefined || current === '';
      if (value !== undefined && value !== '' && unset) {
        process.env[key] = value;
      }
    }
    console.log('Loaded config from Secret Manager (simulation-worker-config)');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('NOT_FOUND') || msg.includes('Permission')) {
      console.log('Secret Manager not used (secret missing or no access). Using env only.');
    } else {
      console.warn('Secret Manager fetch failed:', msg);
    }
  }
}

// ============================================================================
// Subscriptions (for shutdown handler)
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let subscription: any = null;

// ============================================================================
// API Functions
// ============================================================================

function getApiHeaders(): Record<string, string> {
  const AUTH_TOKEN = process.env.AUTH_TOKEN || '';
  const WORKER_SECRET = process.env.WORKER_SECRET || '';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (AUTH_TOKEN) headers['Authorization'] = `Bearer ${AUTH_TOKEN}`;
  if (WORKER_SECRET) headers['X-Worker-Secret'] = WORKER_SECRET;
  return headers;
}

function getApiUrl(): string {
  return process.env.API_URL || 'http://localhost:3000';
}

/**
 * Fetch job details from API
 */
async function fetchJob(jobId: string): Promise<JobData | null> {
  const url = `${getApiUrl()}/api/jobs/${jobId}`;
  try {
    const response = await fetch(url, { headers: getApiHeaders() });
    if (!response.ok) {
      console.error(`Failed to fetch job ${jobId}: ${response.status}`);
      return null;
    }
    return await response.json();
  } catch (error) {
    console.error(`Error fetching job ${jobId}:`, error);
    return null;
  }
}

/**
 * Update job status via API
 */
async function patchJobStatus(jobId: string, status: string, errorMessage?: string, dockerRunDurationsMs?: number[]): Promise<void> {
  const url = `${getApiUrl()}/api/jobs/${jobId}`;
  const body: Record<string, unknown> = { status };
  if (errorMessage) body.errorMessage = errorMessage;
  if (dockerRunDurationsMs) body.dockerRunDurationsMs = dockerRunDurationsMs;
  if (status === 'RUNNING' && currentWorkerId) body.workerId = currentWorkerId;

  try {
    const response = await fetch(url, {
      method: 'PATCH',
      headers: getApiHeaders(),
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      console.error(`Failed to update job status: ${response.status}`);
    }
  } catch (error) {
    console.error(`Error updating job status:`, error);
  }
}

/**
 * Update job progress (gamesCompleted count)
 */
async function updateJobProgress(jobId: string, gamesCompleted: number): Promise<void> {
  const url = `${getApiUrl()}/api/jobs/${jobId}`;
  try {
    await fetch(url, {
      method: 'PATCH',
      headers: getApiHeaders(),
      body: JSON.stringify({ gamesCompleted }),
    });
  } catch {
    // Non-fatal: progress update failing shouldn't crash the job
  }
}

/**
 * Initialize simulation tracking in the API
 */
async function apiInitializeSimulations(jobId: string, count: number): Promise<void> {
  const url = `${getApiUrl()}/api/jobs/${jobId}/simulations`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: getApiHeaders(),
      body: JSON.stringify({ count }),
    });
    if (!response.ok) {
      console.warn(`Failed to initialize simulations: ${response.status}`);
    }
  } catch (error) {
    console.warn('Failed to initialize simulations:', error);
  }
}

/**
 * Report per-simulation status to the API
 */
async function reportSimulationStatus(
  jobId: string,
  simId: string,
  update: Record<string, unknown>
): Promise<void> {
  const url = `${getApiUrl()}/api/jobs/${jobId}/simulations/${simId}`;
  try {
    await fetch(url, {
      method: 'PATCH',
      headers: getApiHeaders(),
      body: JSON.stringify(update),
    });
  } catch {
    // Non-fatal: simulation status update failing shouldn't crash the job
  }
}

// ============================================================================
// Dynamic Parallelism
// ============================================================================

/**
 * Calculate optimal parallelism based on system resources.
 * Scales dynamically based on available CPU cores and memory.
 */
function calculateDynamicParallelism(requested: number): number {
  const cpuCount = os.cpus().length;
  const freeMemMB = os.freemem() / (1024 * 1024);

  const availableMemMB = Math.max(0, freeMemMB - SYSTEM_RESERVE_MB);
  const memoryLimit = Math.floor(availableMemMB / RAM_PER_SIM_MB);

  // Leave 2 cores for system + worker
  const cpuLimit = Math.max(1, cpuCount - 2);

  const optimal = Math.min(requested, cpuLimit, memoryLimit);

  console.log(
    `Dynamic parallelism: cpus=${cpuCount}, freeMem=${Math.round(freeMemMB)}MB, ` +
      `cpuLimit=${cpuLimit}, memLimit=${memoryLimit}, requested=${requested}, using=${Math.max(1, optimal)}`
  );

  return Math.max(1, optimal);
}

// ============================================================================
// Process Execution
// ============================================================================

/**
 * Run a process and wait for it to complete
 */
function runProcess(
  command: string,
  args: string[],
  options: {
    env?: NodeJS.ProcessEnv;
    cwd?: string;
    timeout?: number;
  } = {}
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    let timedOut = false;

    // On macOS, wrap with caffeinate to prevent sleep during execution
    let finalCommand = command;
    let finalArgs = args;
    if (process.platform === 'darwin') {
      finalCommand = 'caffeinate';
      finalArgs = ['-i', command, ...args];
    }

    console.log(`Running: ${finalCommand} ${finalArgs.join(' ')}`);

    const proc: ChildProcess = spawn(finalCommand, finalArgs, {
      stdio: 'inherit',
      env: { ...process.env, ...options.env },
      cwd: options.cwd,
    });

    let timeoutId: NodeJS.Timeout | null = null;
    if (options.timeout) {
      timeoutId = setTimeout(() => {
        timedOut = true;
        console.error(`Process timed out after ${options.timeout}ms, killing...`);
        proc.kill('SIGTERM');
        setTimeout(() => proc.kill('SIGKILL'), 5000);
      }, options.timeout);
    }

    proc.on('error', (error) => {
      if (timeoutId) clearTimeout(timeoutId);
      reject(error);
    });

    proc.on('close', (code, signal) => {
      if (timeoutId) clearTimeout(timeoutId);
      let exitCode: number;
      if (timedOut) {
        exitCode = 124;
      } else if (code !== null) {
        exitCode = code;
      } else if (signal) {
        exitCode = 128 + (signal === 'SIGTERM' ? 15 : signal === 'SIGKILL' ? 9 : 1);
      } else {
        exitCode = 0;
      }
      resolve({ exitCode, duration: Date.now() - startTime });
    });
  });
}

// ============================================================================
// Simulation Execution — Container Mode (new)
// ============================================================================

interface SimulationResult {
  simId: string;
  index: number;
  exitCode: number;
  durationMs: number;
  error?: string;
}

/**
 * Run a single simulation in a Docker container.
 * Each container runs exactly 1 game, writes its log, then exits.
 */
async function runSimulationContainer(
  jobId: string,
  simId: string,
  index: number,
  deckDir: string,
  logDir: string,
  deckFilenames: [string, string, string, string]
): Promise<SimulationResult> {
  const startTime = Date.now();
  const containerName = `sim-${jobId.slice(0, 8)}-${simId}`;

  // Report RUNNING to API
  await reportSimulationStatus(jobId, simId, {
    state: 'RUNNING',
    workerId: currentWorkerId,
  });

  const args = [
    'run', '--rm',
    '--name', containerName,
    `--memory=${RAM_PER_SIM_MB}m`,
    '--cpus=1',
    // Mount deck files read-only into Forge's Commander deck directory
    '-v', `${deckDir}:/home/simulator/.forge/decks/commander:ro`,
    // Mount log output directory
    '-v', `${logDir}:/app/logs`,
    // Environment
    '-e', `FORGE_PATH=/app/forge`,
    '-e', `LOGS_DIR=/app/logs`,
    SIMULATION_IMAGE,
    '--decks', ...deckFilenames,
    '--simulations', '1',
    '--id', `${jobId}_${simId}`,
  ];

  let result: ProcessResult;
  try {
    result = await runProcess('docker', args, { timeout: 24 * 60 * 60 * 1000 });
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : String(error);
    await reportSimulationStatus(jobId, simId, {
      state: 'FAILED',
      durationMs,
      errorMessage: errorMsg,
    });
    return { simId, index, exitCode: 1, durationMs, error: errorMsg };
  }

  const durationMs = Date.now() - startTime;

  if (result.exitCode !== 0) {
    await reportSimulationStatus(jobId, simId, {
      state: 'FAILED',
      durationMs,
      errorMessage: `Exit code ${result.exitCode}`,
    });
    return { simId, index, exitCode: result.exitCode, durationMs, error: `Exit code ${result.exitCode}` };
  }

  await reportSimulationStatus(jobId, simId, {
    state: 'COMPLETED',
    durationMs,
  });

  return { simId, index, exitCode: 0, durationMs };
}

// ============================================================================
// Simulation Execution — Monolithic Mode (legacy, backward compat)
// ============================================================================

/**
 * Run forge simulation as a child process (monolithic mode).
 * Decks must already be written to FORGE_COMMANDER_DECKS_DIR before calling this.
 */
async function runForgeSim(
  jobDir: string,
  simulations: number,
  runId: string,
  deckFilenames: [string, string, string, string]
): Promise<ProcessResult> {
  const logsDir = path.resolve(jobDir, 'logs');
  const runSimScript = path.join(FORGE_PATH, 'run_sim.sh');

  const args = [
    '--decks',
    ...deckFilenames,
    '--simulations',
    String(simulations),
    '--id',
    runId,
  ];

  return runProcess('/bin/bash', [runSimScript, ...args], {
    env: {
      DECKS_DIR: FORGE_COMMANDER_DECKS_DIR,
      LOGS_DIR: logsDir,
    },
    timeout: 24 * 60 * 60 * 1000,
  });
}

/**
 * Split simulations across parallel runs (monolithic mode)
 */
function splitSimulations(total: number, parallelism: number): number[] {
  const runs: number[] = [];
  const base = Math.floor(total / parallelism);
  const remainder = total % parallelism;

  for (let i = 0; i < parallelism; i++) {
    runs.push(base + (i < remainder ? 1 : 0));
  }

  return runs.filter((n) => n > 0);
}

// ============================================================================
// Log Processing
// ============================================================================

/**
 * Read all game logs from the logs directory
 */
async function readGameLogs(
  logsDir: string,
  jobId: string
): Promise<{ rawLogs: string[]; deckNames: string[] }> {
  let files: string[] = [];

  try {
    const allFiles = await fs.readdir(logsDir);
    files = allFiles
      .filter((f) => f.includes(jobId) && f.endsWith('.txt') && f !== 'deck_names.txt')
      .map((f) => path.join(logsDir, f))
      .sort();
  } catch {
    // Directory might not exist
  }

  // Fallback: find any .txt files
  if (files.length === 0) {
    try {
      const allFiles = await fs.readdir(logsDir);
      files = allFiles
        .filter((f) => f.endsWith('.txt') && f !== 'deck_names.txt')
        .map((f) => path.join(logsDir, f))
        .sort();
    } catch {
      // Directory might not exist
    }
  }

  const rawLogs: string[] = [];
  for (const file of files) {
    try {
      const content = await fs.readFile(file, 'utf-8');
      const games = splitConcatenatedGames(content);
      rawLogs.push(...games);
    } catch (err) {
      console.warn(`Warning: Failed to read ${file}:`, err);
    }
  }

  // Try to read deck names from metadata file
  let deckNames = ['Deck 1', 'Deck 2', 'Deck 3', 'Deck 4'];
  try {
    const metaPath = path.join(logsDir, 'deck_names.txt');
    const content = await fs.readFile(metaPath, 'utf-8');
    const names = content
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l);
    if (names.length >= 4) {
      deckNames = names.slice(0, 4);
    }
  } catch {
    // deck_names.txt not found, use defaults
  }

  return { rawLogs, deckNames };
}

/**
 * Process logs and POST to the API
 */
async function processAndUploadLogs(
  jobId: string,
  logsDir: string,
  deckLists: string[]
): Promise<void> {
  console.log('Reading game logs...');
  const { rawLogs, deckNames } = await readGameLogs(logsDir, jobId);
  console.log(`Found ${rawLogs.length} game logs`);

  if (rawLogs.length === 0) {
    throw new Error('No game logs found');
  }

  console.log(`POSTing ${rawLogs.length} game logs to the API...`);

  const response = await fetch(`${getApiUrl()}/api/jobs/${jobId}/logs`, {
    method: 'POST',
    headers: getApiHeaders(),
    body: JSON.stringify({ gameLogs: rawLogs, deckNames, deckLists }),
  });

  if (!response.ok) {
    throw new Error(`Failed to POST logs for job ${jobId}: ${response.status} ${response.statusText}`);
  }

  console.log('Logs posted successfully');
}

// ============================================================================
// Job Processing — Container Mode (new)
// ============================================================================

/**
 * Process a job using Docker containers (1 container per simulation)
 */
async function processJobWithContainers(jobId: string, job: JobData): Promise<void> {
  const totalSims = job.simulations;
  const capacity = calculateDynamicParallelism(totalSims);

  const jobDir = path.join(JOBS_DIR, jobId);
  const deckDir = path.join(jobDir, 'decks');
  const logDir = path.join(jobDir, 'logs');
  await fs.mkdir(deckDir, { recursive: true });
  await fs.mkdir(logDir, { recursive: true });

  // Write deck files
  const deckFilenames: [string, string, string, string] = ['deck_0.dck', 'deck_1.dck', 'deck_2.dck', 'deck_3.dck'];
  const deckNames = job.decks!.map((d) => d.name);
  const deckLists = job.decks!.map((d) => d.dck);

  await Promise.all(
    job.decks!.map((deck, i) =>
      fs.writeFile(path.join(deckDir, deckFilenames[i]), deck.dck, 'utf-8')
    )
  );

  // Write deck_names.txt for log processing
  await fs.writeFile(path.join(logDir, 'deck_names.txt'), deckNames.join('\n'), 'utf-8');

  // Initialize per-simulation tracking in the API
  await apiInitializeSimulations(jobId, totalSims);

  // Generate simulation IDs
  const simIds = Array.from({ length: totalSims }, (_, i) => ({
    simId: `sim_${String(i).padStart(3, '0')}`,
    index: i,
  }));

  console.log(`Running ${totalSims} simulations with concurrency=${capacity}`);

  // Run simulations with bounded concurrency
  const semaphore = new Semaphore(capacity);
  const results: SimulationResult[] = [];
  let completedCount = 0;

  await Promise.all(
    simIds.map(async ({ simId, index }) => {
      await semaphore.acquire();
      try {
        const result = await runSimulationContainer(
          jobId, simId, index, deckDir, logDir, deckFilenames
        );
        results.push(result);

        // Update job-level progress
        completedCount++;
        await updateJobProgress(jobId, completedCount);
      } finally {
        semaphore.release();
      }
    })
  );

  // Check for complete failure
  const succeeded = results.filter((r) => r.exitCode === 0);
  const failed = results.filter((r) => r.exitCode !== 0);

  const durations = results.map((r) => r.durationMs);
  console.log(`Simulations completed: ${succeeded.length} succeeded, ${failed.length} failed`);
  console.log(`Durations: ${durations.map((d) => `${d}ms`).join(', ')}`);

  if (succeeded.length === 0) {
    throw new Error(`All ${totalSims} simulations failed`);
  }

  // Process logs and POST to the API
  console.log(`Processing and posting logs for job ${jobId}...`);
  await processAndUploadLogs(jobId, logDir, deckLists);

  // Update job status to COMPLETED
  await patchJobStatus(jobId, 'COMPLETED', undefined, durations);

  // Clean up temp files
  try {
    await fs.rm(jobDir, { recursive: true, force: true });
  } catch {
    console.warn(`Warning: Failed to clean up ${jobDir}`);
  }

  console.log(`Job ${jobId} completed successfully`);
}

// ============================================================================
// Job Processing — Monolithic Mode (legacy)
// ============================================================================

/**
 * Process a job using child processes (legacy monolithic mode)
 */
async function processJobMonolithic(jobId: string, job: JobData): Promise<void> {
  const jobDir = path.join(JOBS_DIR, jobId);
  const logsDir = path.join(jobDir, 'logs');
  await fs.mkdir(logsDir, { recursive: true });

  // Write decks to Forge's Commander deck directory
  await fs.mkdir(FORGE_COMMANDER_DECKS_DIR, { recursive: true });
  const deckFilenames: [string, string, string, string] = ['deck_0.dck', 'deck_1.dck', 'deck_2.dck', 'deck_3.dck'];
  const deckNames = job.decks!.map((d) => d.name);
  const deckLists = job.decks!.map((d) => d.dck);

  await Promise.all(
    job.decks!.map((deck, i) =>
      fs.writeFile(path.join(FORGE_COMMANDER_DECKS_DIR, deckFilenames[i]), deck.dck, 'utf-8')
    )
  );

  const deckNamesPath = path.join(logsDir, 'deck_names.txt');
  await fs.writeFile(deckNamesPath, deckNames.join('\n'), 'utf-8');

  // Calculate dynamic parallelism
  const requestedParallelism = job.parallelism || 4;
  const parallelism = calculateDynamicParallelism(requestedParallelism);
  const runs = splitSimulations(job.simulations, parallelism);
  console.log(`Running ${runs.length} parallel simulations: ${runs.join(', ')}`);

  // Run forge simulations in parallel
  const forgeResults = await Promise.all(
    runs.map((sims, idx) =>
      runForgeSim(jobDir, sims, `job_${jobId}_run${idx}`, deckFilenames)
    )
  );

  // Check for failures
  const failedRuns = forgeResults.filter((r) => r.exitCode !== 0);
  if (failedRuns.length > 0) {
    throw new Error(`${failedRuns.length} forge simulation runs failed`);
  }

  const durations = forgeResults.map((r) => r.duration);
  console.log(`Forge simulations completed in: ${durations.map((d) => `${d}ms`).join(', ')}`);

  // Process logs and POST to the API
  console.log(`Processing and posting logs for job ${jobId}...`);
  await processAndUploadLogs(jobId, logsDir, deckLists);

  // Update job status to COMPLETED
  await patchJobStatus(jobId, 'COMPLETED', undefined, durations);

  console.log(`Job ${jobId} completed successfully`);
}

// ============================================================================
// Job Processing (dispatcher)
// ============================================================================

/**
 * Process a single job — dispatches to container or monolithic mode
 */
async function processJob(jobId: string): Promise<void> {
  console.log(`Processing job ${jobId}...`);

  // Fetch job details
  const job = await fetchJob(jobId);
  if (!job) {
    throw new Error(`Job ${jobId} not found`);
  }

  // Skip if not queued
  if (job.status !== 'QUEUED') {
    console.log(`Job ${jobId} is not QUEUED (status: ${job.status}), skipping`);
    return;
  }

  if (!job.decks || job.decks.length !== 4) {
    throw new Error('Job must have exactly 4 decks with full content');
  }

  // Update status to RUNNING
  await patchJobStatus(jobId, 'RUNNING');

  if (USE_CONTAINERS) {
    await processJobWithContainers(jobId, job);
  } else {
    await processJobMonolithic(jobId, job);
  }
}

// ============================================================================
// Docker Image Management
// ============================================================================

/**
 * Pre-pull the simulation Docker image on startup.
 * Non-fatal — the image might already be local.
 */
async function ensureSimulationImage(): Promise<void> {
  console.log(`Pre-pulling simulation image: ${SIMULATION_IMAGE}`);
  try {
    const result = await runProcess('docker', ['pull', SIMULATION_IMAGE], {
      timeout: 5 * 60 * 1000,
    });
    if (result.exitCode !== 0) {
      console.warn(`Warning: Failed to pull simulation image (exit ${result.exitCode}). Using local image if available.`);
    } else {
      console.log('Simulation image pulled successfully');
    }
  } catch {
    console.warn('Warning: Docker pull failed. Simulation image must be available locally.');
  }
}

// ============================================================================
// Pub/Sub Message Handlers
// ============================================================================

/**
 * Handle a Pub/Sub message.
 * In container mode, multiple jobs can run concurrently since each simulation
 * runs in an isolated container with no shared filesystem.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleMessage(message: any): Promise<void> {
  let messageData: JobCreatedMessage;

  try {
    messageData = JSON.parse(message.data.toString());
  } catch (error) {
    console.error('Failed to parse message:', error);
    message.ack(); // Ack invalid messages to prevent redelivery
    return;
  }

  const { jobId } = messageData;
  console.log(`Received job-created message for job ${jobId}`);

  try {
    await processJob(jobId);
    message.ack();
    console.log(`Message acknowledged for job ${jobId}`);
  } catch (error) {
    console.error(`Error processing job ${jobId}:`, error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await patchJobStatus(jobId, 'FAILED', errorMessage);
    message.nack(); // Nack to trigger retry (with backoff)
  }
}


// ============================================================================
// Polling Mode (local, no Pub/Sub)
// ============================================================================

async function pollForJobs(): Promise<void> {
  const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '3000', 10);

  console.log(`Polling for jobs at ${getApiUrl()}/api/jobs/next every ${POLL_INTERVAL_MS}ms...`);

  while (!isShuttingDown) {
    try {
      const res = await fetch(`${getApiUrl()}/api/jobs/next`, { headers: getApiHeaders() });
      if (res.status === 200) {
        const job = await res.json();
        try {
          await processJob(job.id);
        } catch (error) {
          console.error(`Error processing job ${job.id}:`, error);
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          await patchJobStatus(job.id, 'FAILED', errorMessage);
        }
        continue; // Check immediately for more jobs
      }
    } catch (error) {
      console.error('Polling error:', error);
    }
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

// ============================================================================
// Shutdown Handler
// ============================================================================

let isShuttingDown = false;

function handleShutdown(signal: string): void {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`Received ${signal}, shutting down gracefully...`);

  const closeJobSub = subscription ? subscription.close() : Promise.resolve();
  closeJobSub
    .then(() => {
      console.log('Subscription closed');
      process.exit(0);
    })
    .catch((error: unknown) => {
      console.error('Error closing subscription:', error);
      process.exit(1);
    });

  // Force exit after 30 seconds
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

// ============================================================================
// Main Entry Point
// ============================================================================

async function main(): Promise<void> {
  await loadConfigFromSecretManager();

  const usePubSub = !!process.env.PUBSUB_SUBSCRIPTION;

  currentWorkerId = await getOrCreateWorkerId(JOBS_DIR);
  console.log('Worker ID:', currentWorkerId.slice(0, 8) + '...');

  console.log('Worker starting...');
  console.log('Mode:', USE_CONTAINERS ? 'Container Orchestrator' : 'Monolithic (legacy)');
  console.log('Transport:', usePubSub ? 'Pub/Sub' : 'Polling');
  console.log('API URL:', getApiUrl());
  console.log('Jobs directory:', JOBS_DIR);

  if (USE_CONTAINERS) {
    console.log('Simulation image:', SIMULATION_IMAGE);
    await ensureSimulationImage();
  } else {
    console.log('Forge path:', FORGE_PATH);
  }

  // Ensure jobs directory exists
  await fs.mkdir(JOBS_DIR, { recursive: true });

  if (usePubSub) {
    const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'magic-bracket-simulator';
    const SUBSCRIPTION_NAME = process.env.PUBSUB_SUBSCRIPTION!;

    const { PubSub } = await import('@google-cloud/pubsub');
    const pubsub = new PubSub({ projectId: PROJECT_ID });

    // In container mode, we can handle multiple jobs concurrently since
    // each simulation runs in an isolated container. The capacity is
    // roughly how many simulations we can run in parallel.
    const maxMessages = USE_CONTAINERS
      ? calculateDynamicParallelism(16) // Fill capacity
      : 1; // Monolithic mode: one job at a time to avoid deck-file collisions

    subscription = pubsub.subscription(SUBSCRIPTION_NAME, {
      flowControl: { maxMessages },
    });

    console.log('Project:', PROJECT_ID);
    console.log('Subscription:', SUBSCRIPTION_NAME);
    console.log(`Subscribing to Pub/Sub messages (maxMessages=${maxMessages})...`);

    subscription.on('message', handleMessage);
    subscription.on('error', (error: unknown) => {
      console.error('Job subscription error:', error);
    });

    console.log('Worker is running. Waiting for messages...');
  } else {
    console.log('Worker is running in polling mode.');
    await pollForJobs();
  }
}

main().catch((error) => {
  console.error('Worker failed to start:', error);
  process.exit(1);
});
