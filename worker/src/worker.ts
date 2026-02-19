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
 * Worker: Processes individual simulations via `docker run --rm`
 *
 * Per-simulation architecture:
 * 1. Loads config from Google Secret Manager (if GOOGLE_CLOUD_PROJECT set) or env
 * 2. Receives simulation tasks via Pub/Sub (1 message = 1 simulation) or polls for jobs
 * 3. Fetches job details from the API for deck data
 * 4. Runs a single simulation container via `docker run --rm`
 * 5. Reports per-simulation status to the API (RUNNING/COMPLETED/FAILED)
 * 6. Uploads individual simulation logs incrementally
 * 7. API auto-aggregates when all simulations complete
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import {
  JobData,
  SimulationTaskMessage,
  JobCreatedMessage,
} from './types.js';
import { runProcess } from './process.js';
import {
  runSimulationContainer,
  calculateLocalCapacity,
} from './docker-runner.js';
import { extractWinningTurn } from './condenser.js';

const SECRET_NAME = 'simulation-worker-config';
const WORKER_ID_FILE = 'worker-id';
const API_TIMEOUT_MS = 10_000;

// Module-scoped worker ID and name, set in main() after initialization
let currentWorkerId = '';
let currentWorkerName = '';

// Heartbeat tracking
let activeSimCount = 0;
let localCapacity = 0;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
const workerStartTime = Date.now();

// Shared simulation concurrency semaphore, initialized in main()
let simSemaphore: Semaphore | null = null;

// ============================================================================
// Worker Naming
// ============================================================================

/**
 * Get the worker's display name.
 * Priority: WORKER_NAME env var > hostname
 */
function getWorkerName(): string {
  const envName = process.env.WORKER_NAME?.trim();
  if (envName && envName.length > 0) return envName;
  return os.hostname();
}

// ============================================================================
// Configuration
// ============================================================================

const SIMULATION_IMAGE = process.env.SIMULATION_IMAGE || 'ghcr.io/tytaniumdev/magicbracketsimulator/simulation:latest';
const JOBS_DIR = process.env.JOBS_DIR || '/tmp/mbs-jobs';

// ============================================================================
// Helpers
// ============================================================================

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000) % 60;
  const minutes = Math.floor(ms / 60000);
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
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
    const response = await fetch(url, {
      headers: getApiHeaders(),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
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
 * Report per-simulation status to the API.
 * The API auto-detects job lifecycle transitions (QUEUED->RUNNING, all done->aggregate).
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
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
  } catch {
    // Non-fatal: simulation status update failing shouldn't crash the sim
  }
}

// ============================================================================
// Log Processing
// ============================================================================

/**
 * Extract winner and winning turn from a single game's log text.
 * Uses the same pattern as the API condenser (patterns.ts EXTRACT_WINNER).
 */
function extractWinnerFromLog(logText: string): { winner?: string; winningTurn?: number } {
  const winnerMatch = logText.match(/(.+?)\s+(?:wins\s+the\s+game|has\s+won!?)(?:\s|$|!|\.)/i);
  if (!winnerMatch) return {};

  const winner = winnerMatch[1].trim();
  const winningTurn = extractWinningTurn(logText);

  return { winner, winningTurn: winningTurn > 0 ? winningTurn : undefined };
}

/**
 * Upload a single simulation's raw log to the API (incremental, non-fatal).
 */
async function uploadSingleSimulationLog(
  jobId: string,
  simIndex: number,
  logText: string
): Promise<void> {
  const filename = `raw/game_${String(simIndex + 1).padStart(3, '0')}.txt`;
  const url = `${getApiUrl()}/api/jobs/${jobId}/logs/simulation`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: getApiHeaders(),
      body: JSON.stringify({ filename, logText }),
      signal: AbortSignal.timeout(30_000), // Logs can be large, allow 30s
    });
    if (!res.ok) {
      console.warn(`[sim_${String(simIndex).padStart(3, '0')}] Log upload failed: HTTP ${res.status}`);
    } else {
      console.log(`[sim_${String(simIndex).padStart(3, '0')}] Log uploaded (${(logText.length / 1024).toFixed(1)}KB)`);
    }
  } catch (err) {
    console.warn(`[sim_${String(simIndex).padStart(3, '0')}] Log upload error:`, err instanceof Error ? err.message : err);
  }
}

// ============================================================================
// Simulation Processing
// ============================================================================

/**
 * Process a single simulation: fetch job data, run container, report results.
 * This is the core unit of work in the per-simulation architecture.
 */
async function processSimulation(
  jobId: string,
  simId: string,
  simIndex: number
): Promise<void> {
  const simLabel = `[${simId}]`;
  console.log(`${simLabel} Processing simulation for job ${jobId}`);

  // Fetch job for deck data
  const job = await fetchJob(jobId);
  if (!job) {
    console.error(`${simLabel} Job ${jobId} not found, reporting FAILED`);
    await reportSimulationStatus(jobId, simId, {
      state: 'FAILED',
      errorMessage: 'Job not found',
    });
    return;
  }

  // Check if job has been cancelled
  if (job.status === 'CANCELLED') {
    console.log(`${simLabel} Job ${jobId} is cancelled, skipping`);
    await reportSimulationStatus(jobId, simId, { state: 'CANCELLED' });
    return;
  }

  if (!job.decks || job.decks.length !== 4) {
    console.error(`${simLabel} Job ${jobId} missing deck data`);
    await reportSimulationStatus(jobId, simId, {
      state: 'FAILED',
      errorMessage: 'Job missing deck data',
    });
    return;
  }

  const deckContents: [string, string, string, string] = [
    job.decks[0].dck,
    job.decks[1].dck,
    job.decks[2].dck,
    job.decks[3].dck,
  ];

  // Report RUNNING
  activeSimCount++;
  await reportSimulationStatus(jobId, simId, {
    state: 'RUNNING',
    workerId: currentWorkerId,
    workerName: currentWorkerName,
  });

  // Set up cancellation polling: check job status every 5s
  const abortController = new AbortController();
  const cancellationPollInterval = setInterval(async () => {
    try {
      const pollJob = await fetchJob(jobId);
      if (pollJob?.status === 'CANCELLED') {
        console.log(`${simLabel} Job ${jobId} cancelled, aborting container...`);
        abortController.abort();
        clearInterval(cancellationPollInterval);
      }
    } catch {
      // Non-fatal: polling failure shouldn't affect the simulation
    }
  }, 5000);

  try {
    // Run the simulation container with cancellation signal
    const result = await runSimulationContainer(jobId, simId, simIndex, deckContents, abortController.signal);

    if (result.error === 'Cancelled') {
      console.log(`${simLabel} CANCELLED in ${formatDuration(result.durationMs)}`);
      await reportSimulationStatus(jobId, simId, {
        state: 'CANCELLED',
        durationMs: result.durationMs,
      });
    } else if (result.exitCode === 0) {
      const { winner, winningTurn } = extractWinnerFromLog(result.logText);
      if (winner) {
        console.log(`${simLabel} COMPLETED in ${formatDuration(result.durationMs)}, winner=${winner}${winningTurn ? ` turn=${winningTurn}` : ''}, logSize=${(result.logText.length / 1024).toFixed(1)}KB`);
      } else {
        console.log(`${simLabel} COMPLETED in ${formatDuration(result.durationMs)}, no winner found, logSize=${(result.logText.length / 1024).toFixed(1)}KB`);
      }

      await reportSimulationStatus(jobId, simId, {
        state: 'COMPLETED',
        durationMs: result.durationMs,
        ...(winner && { winner }),
        ...(winningTurn !== undefined && { winningTurn }),
      });

      // Upload log incrementally (non-fatal)
      if (result.logText.trim()) {
        await uploadSingleSimulationLog(jobId, simIndex, result.logText);
      }
    } else {
      console.log(`${simLabel} FAILED in ${formatDuration(result.durationMs)}: ${result.error || `Exit code ${result.exitCode}`}`);
      if (result.logText) {
        console.log(`${simLabel} Log preview (first 500 chars): ${result.logText.slice(0, 500)}`);
      }

      await reportSimulationStatus(jobId, simId, {
        state: 'FAILED',
        durationMs: result.durationMs,
        errorMessage: result.error || `Exit code ${result.exitCode}`,
      });
    }
  } finally {
    clearInterval(cancellationPollInterval);
    activeSimCount = Math.max(0, activeSimCount - 1);
  }
}

// ============================================================================
// Heartbeat
// ============================================================================

/**
 * Send a heartbeat to the API so the frontend knows this worker is online.
 */
async function sendHeartbeat(status?: 'idle' | 'busy' | 'updating', timeoutMs?: number): Promise<void> {
  const url = `${getApiUrl()}/api/workers/heartbeat`;
  const resolvedStatus = status ?? (activeSimCount > 0 ? 'busy' : 'idle');
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: getApiHeaders(),
      body: JSON.stringify({
        workerId: currentWorkerId,
        workerName: currentWorkerName,
        status: resolvedStatus,
        capacity: localCapacity,
        activeSimulations: activeSimCount,
        uptimeMs: Date.now() - workerStartTime,
      }),
      signal: AbortSignal.timeout(timeoutMs ?? API_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`Heartbeat failed: HTTP ${res.status} ${res.statusText}`);
    }
  } catch (err) {
    console.warn('Heartbeat error:', err instanceof Error ? err.message : err);
  }
}

// ============================================================================
// Docker Image Management
// ============================================================================

/**
 * Pre-pull the simulation Docker image on startup.
 * Non-fatal -- the image might already be local.
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

/**
 * Verify Docker daemon is accessible.
 */
async function verifyDockerAvailable(): Promise<void> {
  try {
    const result = await runProcess('docker', ['info'], { timeout: 10_000 });
    if (result.exitCode !== 0) {
      throw new Error('Docker info returned non-zero exit code');
    }
    console.log('Docker: available');
  } catch (err) {
    throw new Error(
      `Docker is not accessible. Ensure Docker is installed and running. ` +
      `Error: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

// ============================================================================
// Concurrency Control
// ============================================================================

/**
 * Semaphore for bounding simulation concurrency.
 * Used by both Pub/Sub and polling modes.
 */
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

  /** Non-blocking acquire. Returns true if a slot was available, false otherwise. */
  tryAcquire(): boolean {
    if (this.count > 0) {
      this.count--;
      return true;
    }
    return false;
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
// Pub/Sub Message Handler
// ============================================================================

/**
 * Handle a Pub/Sub message (one message = one simulation).
 * Pub/Sub flow control limits concurrent messages to localCapacity.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleMessage(message: any): Promise<void> {
  let messageData: SimulationTaskMessage | JobCreatedMessage;

  try {
    messageData = JSON.parse(message.data.toString());
  } catch (error) {
    console.error('Failed to parse message:', error);
    message.ack(); // Ack invalid messages to prevent redelivery
    return;
  }

  // Handle per-simulation messages
  if ('type' in messageData && messageData.type === 'simulation') {
    const { jobId, simId, simIndex } = messageData;

    // Enforce concurrency cap: if all slots are busy, nack immediately
    if (!simSemaphore || !simSemaphore.tryAcquire()) {
      console.log(`At capacity, nacking simulation task: job=${jobId} sim=${simId}`);
      message.nack();
      return;
    }

    console.log(`Received simulation task: job=${jobId} sim=${simId}`);

    try {
      await processSimulation(jobId, simId, simIndex);
      message.ack();
    } catch (error) {
      console.error(`Error processing simulation ${simId} for job ${jobId}:`, error);
      await reportSimulationStatus(jobId, simId, {
        state: 'FAILED',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      });
      message.nack(); // Nack to trigger retry with backoff
    } finally {
      simSemaphore.release();
    }
    return;
  }

  // Legacy: handle job-level messages (from stale job recovery on older API versions)
  if ('jobId' in messageData) {
    console.log(`Received legacy job-created message for job ${messageData.jobId}, acking`);
    message.ack();
    return;
  }

  console.warn('Unknown message format, acking:', messageData);
  message.ack();
}

// ============================================================================
// Polling Mode (local, no Pub/Sub)
// ============================================================================

async function pollForJobs(): Promise<void> {
  const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '3000', 10);

  console.log(`Polling for jobs at ${getApiUrl()}/api/jobs/next every ${POLL_INTERVAL_MS}ms (capacity=${localCapacity})...`);

  while (!isShuttingDown) {
    try {
      const res = await fetch(`${getApiUrl()}/api/jobs/next`, {
        headers: getApiHeaders(),
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });
      if (res.status === 200) {
        const job = await res.json() as JobData;

        // Process all simulations for this job with bounded concurrency
        const totalSims = job.simulations;
        const simIds = Array.from({ length: totalSims }, (_, i) => ({
          simId: `sim_${String(i).padStart(3, '0')}`,
          index: i,
        }));

        console.log(`Claimed job ${job.id}: running ${totalSims} simulations with capacity=${localCapacity}`);

        await Promise.all(
          simIds.map(async ({ simId, index }) => {
            await simSemaphore!.acquire();
            try {
              await processSimulation(job.id, simId, index);
            } catch (error) {
              console.error(`Error processing simulation ${simId} for job ${job.id}:`, error);
              await reportSimulationStatus(job.id, simId, {
                state: 'FAILED',
                errorMessage: error instanceof Error ? error.message : 'Unknown error',
              });
            } finally {
              simSemaphore!.release();
            }
          })
        );

        console.log(`Job ${job.id}: all simulations processed`);
        continue; // Check immediately for more jobs
      }
    } catch (error) {
      if (error instanceof Error && error.name !== 'TimeoutError') {
        console.error('Polling error:', error);
      }
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

  // Stop periodic heartbeat
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }

  // Send a final 'updating' heartbeat so the frontend knows we're restarting
  const updatingHeartbeat = sendHeartbeat('updating', 5_000)
    .then(() => console.log('Sent updating heartbeat'))
    .catch((err) => console.warn('Failed to send updating heartbeat:', err instanceof Error ? err.message : err));

  // After the heartbeat (or timeout), close Pub/Sub and exit
  updatingHeartbeat.finally(() => {
    const closeSub = subscription ? subscription.close() : Promise.resolve();
    closeSub
      .then(() => {
        console.log('Shutdown complete');
        process.exit(0);
      })
      .catch((error: unknown) => {
        console.error('Error during shutdown:', error);
        process.exit(1);
      });
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
  currentWorkerName = getWorkerName();
  console.log('Worker ID:', currentWorkerId.slice(0, 8) + '...');
  console.log('Worker Name:', currentWorkerName);

  console.log('Worker starting...');
  console.log('Mode: Per-Simulation (docker run --rm)');
  console.log('Transport:', usePubSub ? 'Pub/Sub' : 'Polling');
  console.log('API URL:', getApiUrl());
  console.log('Simulation image:', SIMULATION_IMAGE);

  // Verify Docker is accessible
  await verifyDockerAvailable();

  // Pre-pull simulation image
  await ensureSimulationImage();

  // Calculate capacity for heartbeat and flow control
  localCapacity = calculateLocalCapacity();
  simSemaphore = new Semaphore(localCapacity);

  // Start heartbeat interval (every 15 seconds)
  sendHeartbeat(); // Initial heartbeat
  heartbeatInterval = setInterval(() => sendHeartbeat(), 15_000);

  if (usePubSub) {
    const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'magic-bracket-simulator';
    const SUBSCRIPTION_NAME = process.env.PUBSUB_SUBSCRIPTION!;

    const { PubSub } = await import('@google-cloud/pubsub');
    const pubsub = new PubSub({ projectId: PROJECT_ID });

    // Pub/Sub flow control: limit message delivery rate (defense-in-depth,
    // the semaphore in handleMessage is the authoritative concurrency gate)
    subscription = pubsub.subscription(SUBSCRIPTION_NAME, {
      flowControl: { maxMessages: localCapacity, allowExcessMessages: false },
    });

    console.log('Project:', PROJECT_ID);
    console.log('Subscription:', SUBSCRIPTION_NAME);
    console.log(`Subscribing to Pub/Sub messages (maxMessages=${localCapacity})...`);

    subscription.on('message', handleMessage);
    subscription.on('error', (error: unknown) => {
      console.error('Subscription error:', error);
    });

    console.log('Worker is running. Waiting for simulation tasks...');
  } else {
    console.log('Worker is running in polling mode.');
    await pollForJobs();
  }
}

main().catch((error) => {
  console.error('Worker failed to start:', error);
  process.exit(1);
});
