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

import * as os from 'os';

import {
  JobData,
  SimulationTaskMessage,
  JobCreatedMessage,
} from './types.js';
import { runProcess } from './process.js';
import {
  runSimulationContainer,
  calculateLocalCapacity,
  cleanupOrphanedContainers,
  pruneDockerResources,
} from './docker-runner.js';
import {
  splitConcatenatedGames,
  extractWinner,
  extractWinningTurn,
} from './condenser.js';
import { startWorkerApi, stopWorkerApi } from './worker-api.js';
import { GAMES_PER_CONTAINER } from './constants.js';


const SECRET_NAME = 'simulation-worker-config';
const API_TIMEOUT_MS = 10_000;

// Module-scoped worker ID and name, set in main() after initialization
let currentWorkerId = '';
let currentWorkerName = '';

// Heartbeat tracking
let activeSimCount = 0;
let localCapacity = 0;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let dockerCleanupInterval: ReturnType<typeof setInterval> | null = null;
const workerStartTime = Date.now();

// Shared simulation concurrency semaphore, initialized in main()
let simSemaphore: Semaphore | null = null;

// Abort controllers per job for push-based cancellation
const activeAbortControllers = new Map<string, Set<AbortController>>();

// Ordered list of all active abort controllers for capacity preemption (most recent at end)
const allActiveAbortControllers: AbortController[] = [];

// Notify mechanism for push-based job notification (local polling mode)
let jobNotifyResolve: (() => void) | null = null;

// Drain flag — when true, worker stops accepting new work
let isDraining = false;

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
 * Get the worker ID.
 * Uses the worker name (hostname) so that overrides and other per-worker
 * config persist across container rebuilds. Previously used a random UUID
 * persisted to a file, which was lost on container recreation.
 * Priority: (1) WORKER_ID env, (2) worker name (hostname).
 */
function getWorkerId(): string {
  const fromEnv = process.env.WORKER_ID?.trim();
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv;
  }
  return getWorkerName();
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

  // Skip if job is already in a terminal state (stale Pub/Sub redelivery, etc.)
  if (job.status === 'COMPLETED' || job.status === 'FAILED') {
    console.log(`${simLabel} Job ${jobId} is already ${job.status}, skipping`);
    return;  // Don't report status — stale scanner may have deleted sim records
  }
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

  // Register abort controller for push-based cancellation and capacity preemption
  const abortController = new AbortController();
  if (!activeAbortControllers.has(jobId)) {
    activeAbortControllers.set(jobId, new Set());
  }
  activeAbortControllers.get(jobId)!.add(abortController);
  allActiveAbortControllers.push(abortController);

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
      // Split concatenated 4-game log and extract per-game winners/turns
      const games = splitConcatenatedGames(result.logText);
      const winners: string[] = [];
      const winningTurns: number[] = [];
      for (const game of games) {
        const w = extractWinner(game);
        if (w) winners.push(w);
        const t = extractWinningTurn(game);
        if (t > 0) winningTurns.push(t);
      }
      console.log(`${simLabel} COMPLETED in ${formatDuration(result.durationMs)}, logSize=${(result.logText.length / 1024).toFixed(1)}KB, games=${games.length}, winners=${winners.length}`);

      await reportSimulationStatus(jobId, simId, {
        state: 'COMPLETED',
        durationMs: result.durationMs,
        winners,
        winningTurns,
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
    // Unregister abort controller from both per-job and global lists
    const controllers = activeAbortControllers.get(jobId);
    if (controllers) {
      controllers.delete(abortController);
      if (controllers.size === 0) activeAbortControllers.delete(jobId);
    }
    const globalIdx = allActiveAbortControllers.indexOf(abortController);
    if (globalIdx !== -1) allActiveAbortControllers.splice(globalIdx, 1);
    activeSimCount = Math.max(0, activeSimCount - 1);
  }
}

// ============================================================================
// Heartbeat
// ============================================================================

// Track whether we're currently operating under an override
let currentOverride: number | null = null;

/**
 * Kill excess running simulations to enforce a reduced capacity limit.
 * Picks the most recently started simulations (LIFO) since they've done the least work.
 */
function killExcessSimulations(excessCount: number): void {
  if (excessCount <= 0 || allActiveAbortControllers.length === 0) return;
  const toKill = Math.min(excessCount, allActiveAbortControllers.length);
  console.log(`Preempting ${toKill} simulation(s) to enforce capacity limit...`);
  // Kill from end (most recently started = least work done)
  const toAbort = allActiveAbortControllers.slice(-toKill);
  for (const controller of toAbort) {
    controller.abort();
  }
}

/**
 * Apply a concurrency override (or clear it).
 * Consolidates semaphore resize logic for use by both heartbeat and push API.
 * When reducing capacity, excess running simulations are killed immediately.
 */
function applyOverride(newOverride: number | null): void {
  if (!simSemaphore) return;

  if (typeof newOverride === 'number') {
    const override = Math.max(1, newOverride);
    if (override !== simSemaphore.maxSlots) {
      const oldMax = simSemaphore.maxSlots;
      const excess = simSemaphore.resize(override);
      console.log(`Capacity override: ${oldMax} -> ${override} (hardware: ${localCapacity})`);
      if (override > localCapacity) {
        console.log(`WARNING: Override (${override}) exceeds hardware capacity (${localCapacity}). CPU/memory contention possible.`);
      }
      if (excess > 0) {
        killExcessSimulations(excess);
      }
    }
    currentOverride = override;
  } else if (currentOverride !== null) {
    // Override was cleared — revert to hardware capacity
    const oldMax = simSemaphore.maxSlots;
    if (oldMax !== localCapacity) {
      const excess = simSemaphore.resize(localCapacity);
      console.log(`Capacity override cleared: ${oldMax} -> ${localCapacity} (hardware)`);
      if (excess > 0) {
        killExcessSimulations(excess);
      }
    }
    currentOverride = null;
  }
}

/**
 * Cancel all active simulations for a job by aborting their controllers.
 */
function cancelJob(jobId: string): void {
  const controllers = activeAbortControllers.get(jobId);
  if (!controllers || controllers.size === 0) {
    console.log(`Cancel push received for job ${jobId}: no active simulations`);
    return;
  }
  console.log(`Cancel push received for job ${jobId}: aborting ${controllers.size} simulation(s)`);
  for (const controller of controllers) {
    controller.abort();
  }
}

/**
 * Wake the polling loop immediately (used by push notification).
 */
function notifyJobAvailable(): void {
  if (jobNotifyResolve) {
    jobNotifyResolve();
    jobNotifyResolve = null;
  }
}

/**
 * Set or clear the drain flag.
 */
function setDraining(drain: boolean): void {
  isDraining = drain;
  console.log(drain ? 'Drain mode enabled: no new work will be accepted' : 'Drain mode disabled: accepting work');
}

/**
 * Send a heartbeat to the API so the frontend knows this worker is online.
 * Parses the response for dynamic concurrency overrides.
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
        ownerEmail: process.env.WORKER_OWNER_EMAIL || undefined,
        workerApiUrl: process.env.WORKER_API_URL || undefined,
      }),
      signal: AbortSignal.timeout(timeoutMs ?? API_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`Heartbeat failed: HTTP ${res.status} ${res.statusText}`);
      return;
    }

    // Parse response for concurrency override
    const data = await res.json() as { ok: boolean; maxConcurrentOverride?: number };
    if (status !== 'updating') {
      applyOverride(data.maxConcurrentOverride ?? null);
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
 * Tracks in-flight count so release() respects the current max after resize.
 */
class Semaphore {
  private _available: number;
  private _max: number;
  private _inFlight: number = 0;
  private _waiting: (() => void)[] = [];

  constructor(max: number) {
    this._available = max;
    this._max = max;
  }

  get maxSlots(): number {
    return this._max;
  }

  get inFlight(): number {
    return this._inFlight;
  }

  async acquire(): Promise<void> {
    if (this._available > 0) {
      this._available--;
      this._inFlight++;
      return;
    }
    return new Promise<void>((resolve) => this._waiting.push(resolve));
  }

  /** Non-blocking acquire. Returns true if a slot was available, false otherwise. */
  tryAcquire(): boolean {
    if (this._available > 0) {
      this._available--;
      this._inFlight++;
      return true;
    }
    return false;
  }

  release(): void {
    this._inFlight--;
    if (this._inFlight < this._max) {
      // Under capacity: wake a waiter or return slot to pool
      if (this._waiting.length > 0) {
        this._inFlight++;
        const next = this._waiting.shift()!;
        next();
      } else {
        this._available = Math.min(this._max - this._inFlight, this._available + 1);
      }
    }
    // At or above capacity after resize: slot is absorbed, running count drains naturally
  }

  /**
   * Dynamically resize the semaphore.
   * If increasing: wake waiting tasks or add available slots.
   * If decreasing: cap available slots and return excess in-flight count
   *   for the caller to preempt.
   */
  resize(newMax: number): number {
    const oldMax = this._max;
    if (newMax === oldMax) return 0;
    this._max = newMax;
    if (newMax > oldMax) {
      // Increasing: wake waiters or add available slots
      const delta = newMax - oldMax;
      for (let i = 0; i < delta; i++) {
        if (this._waiting.length > 0 && this._inFlight < newMax) {
          this._inFlight++;
          const next = this._waiting.shift()!;
          next();
        } else if (this._inFlight + this._available < newMax) {
          this._available++;
        }
      }
      return 0;
    } else {
      // Decreasing: cap available slots, return excess for preemption
      this._available = Math.max(0, Math.min(this._available, newMax - this._inFlight));
      return Math.max(0, this._inFlight - newMax);
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

    // Reject work when draining
    if (isDraining) {
      console.log(`Draining, nacking simulation task: job=${jobId} sim=${simId}`);
      message.nack();
      return;
    }

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

/**
 * Wait for either a timeout or a push notification to wake us.
 */
function waitForNotifyOrTimeout(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      jobNotifyResolve = null;
      resolve();
    }, ms);
    jobNotifyResolve = () => {
      clearTimeout(timer);
      resolve();
    };
  });
}

async function pollForJobs(): Promise<void> {
  const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '3000', 10);

  console.log(`Polling for jobs at ${getApiUrl()}/api/jobs/next every ${POLL_INTERVAL_MS}ms (capacity=${localCapacity})...`);

  while (!isShuttingDown) {
    // Skip claiming when draining
    if (isDraining) {
      await waitForNotifyOrTimeout(POLL_INTERVAL_MS);
      continue;
    }

    try {
      const res = await fetch(`${getApiUrl()}/api/jobs/next`, {
        headers: getApiHeaders(),
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });
      if (res.status === 200) {
        const job = await res.json() as JobData;

        // Each container runs GAMES_PER_CONTAINER games; derive container count
        const totalSims = Math.ceil(job.simulations / GAMES_PER_CONTAINER);
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
    await waitForNotifyOrTimeout(POLL_INTERVAL_MS);
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

  // Stop periodic heartbeat and Docker cleanup
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  if (dockerCleanupInterval) {
    clearInterval(dockerCleanupInterval);
    dockerCleanupInterval = null;
  }

  // Send a final 'updating' heartbeat so the frontend knows we're restarting
  const updatingHeartbeat = sendHeartbeat('updating', 5_000)
    .then(() => console.log('Sent updating heartbeat'))
    .catch((err) => console.warn('Failed to send updating heartbeat:', err instanceof Error ? err.message : err));

  // After the heartbeat (or timeout), close Pub/Sub + worker API and exit
  updatingHeartbeat.finally(() => {
    const closeSub = subscription ? subscription.close() : Promise.resolve();
    const closeApi = stopWorkerApi().catch(() => {});
    Promise.all([closeSub, closeApi])
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

  currentWorkerName = getWorkerName();
  currentWorkerId = getWorkerId();
  console.log('Worker ID:', currentWorkerId);
  console.log('Worker Name:', currentWorkerName);

  console.log('Worker starting...');
  console.log('Mode: Per-Simulation (docker run --rm)');
  console.log('Transport:', usePubSub ? 'Pub/Sub' : 'Polling');
  console.log('API URL:', getApiUrl());
  console.log('Simulation image:', SIMULATION_IMAGE);

  // Verify Docker is accessible
  await verifyDockerAvailable();

  // Startup cleanup: remove orphaned containers and prune unused resources
  await cleanupOrphanedContainers();
  await pruneDockerResources();

  // Pre-pull simulation image (after prune so it's not removed)
  await ensureSimulationImage();

  // Calculate capacity for heartbeat and flow control
  localCapacity = calculateLocalCapacity();
  simSemaphore = new Semaphore(localCapacity);

  // Start worker HTTP API for push-based control
  await startWorkerApi({
    onConfig: applyOverride,
    onCancel: cancelJob,
    onNotify: notifyJobAvailable,
    onDrain: setDraining,
  });

  // Initial heartbeat (await to apply override before Pub/Sub starts)
  await sendHeartbeat();
  heartbeatInterval = setInterval(() => sendHeartbeat(), 15_000);

  // Periodic Docker cleanup (every hour) to free disk space
  dockerCleanupInterval = setInterval(() => {
    console.log('Periodic Docker cleanup...');
    pruneDockerResources().catch((err) =>
      console.warn('Periodic Docker cleanup error:', err instanceof Error ? err.message : err),
    );
  }, 60 * 60 * 1000);

  if (usePubSub) {
    const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'magic-bracket-simulator';
    const SUBSCRIPTION_NAME = process.env.PUBSUB_SUBSCRIPTION!;

    const { PubSub } = await import('@google-cloud/pubsub');
    const pubsub = new PubSub({ projectId: PROJECT_ID });

    // Pub/Sub flow control: limit message delivery rate (defense-in-depth,
    // the semaphore in handleMessage is the authoritative concurrency gate).
    // Uses simSemaphore.maxSlots so override from initial heartbeat is respected.
    subscription = pubsub.subscription(SUBSCRIPTION_NAME, {
      flowControl: { maxMessages: simSemaphore.maxSlots, allowExcessMessages: false },
    });

    console.log('Project:', PROJECT_ID);
    console.log('Subscription:', SUBSCRIPTION_NAME);
    console.log(`Subscribing to Pub/Sub messages (maxMessages=${simSemaphore.maxSlots})...`);

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
