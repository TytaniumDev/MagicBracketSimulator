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

import { JobData } from './types.js';
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
import { startWorkerApi, stopWorkerApi, HealthStatus } from './worker-api.js';
import { createLogger } from './logger.js';
import { captureWorkerException, addWorkerBreadcrumb, flushSentry } from './sentry.js';

const log = createLogger('Worker');


const SECRET_NAME = 'simulation-worker-config';
const API_TIMEOUT_MS = parseInt(process.env.API_TIMEOUT_MS || '10000', 10);

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
 * Returns true if the update was accepted, false if the API rejected it (e.g. sim already terminal).
 */
async function reportSimulationStatus(
  jobId: string,
  simId: string,
  update: Record<string, unknown>
): Promise<boolean> {
  const url = `${getApiUrl()}/api/jobs/${jobId}/simulations/${simId}`;
  try {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: getApiHeaders(),
      body: JSON.stringify(update),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    if (res.ok) {
      const data = await res.json() as { updated?: boolean };
      return data.updated !== false;
    }
    return false;
  } catch {
    // Non-fatal: simulation status update failing shouldn't crash the sim
    return true; // Assume accepted on network failure to avoid skipping work
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
      captureWorkerException(
        new Error(`Log upload failed: HTTP ${res.status}`),
        { component: 'log-upload', jobId, simIndex, workerId: currentWorkerId }
      );
    } else {
      console.log(`[sim_${String(simIndex).padStart(3, '0')}] Log uploaded (${(logText.length / 1024).toFixed(1)}KB)`);
    }
  } catch (err) {
    console.warn(`[sim_${String(simIndex).padStart(3, '0')}] Log upload error:`, err instanceof Error ? err.message : err);
    captureWorkerException(err, {
      component: 'log-upload',
      jobId,
      simIndex,
      workerId: currentWorkerId,
    });
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
  addWorkerBreadcrumb('processSimulation:start', { jobId, simId, simIndex });

  try {
    await processSimulationInternal(jobId, simId, simIndex);
  } catch (err) {
    // Any uncaught error from container orchestration, reporting, etc.
    // lands here. Capture with full context before re-throwing so the
    // caller's error handling (semaphore release, abort cleanup) still runs.
    captureWorkerException(err, {
      component: 'process-simulation',
      jobId,
      simId,
      simIndex,
      workerId: currentWorkerId,
    });
    throw err;
  }
}

async function processSimulationInternal(
  jobId: string,
  simId: string,
  simIndex: number
): Promise<void> {
  const simLabel = `[${simId}]`;

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

  // claim-sim has already flipped this sim to RUNNING with our workerId;
  // no need to PATCH here. Just bump the in-flight counter.
  activeSimCount++;

  // Register abort controller for push-based cancellation and capacity preemption
  const abortController = new AbortController();
  if (!activeAbortControllers.has(jobId)) {
    activeAbortControllers.set(jobId, new Set());
  }
  activeAbortControllers.get(jobId)!.add(abortController);
  allActiveAbortControllers.push(abortController);

  try {
    const MAX_RETRIES = 2;
    const RETRY_DELAY_MS = 30_000;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      // Run the simulation container with cancellation signal
      const result = await runSimulationContainer(jobId, simId, simIndex, deckContents, abortController.signal);

      if (result.error === 'AlreadyRunning') {
        // Container is already running from a previous attempt — don't report status
        return;
      } else if (result.error === 'Cancelled') {
        console.log(`${simLabel} CANCELLED in ${formatDuration(result.durationMs)}`);
        await reportSimulationStatus(jobId, simId, {
          state: 'CANCELLED',
          durationMs: result.durationMs,
        });
        return;
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
        return;
      } else {
        // Container failed — retry locally before reporting FAILED
        const errorMsg = result.error || `Exit code ${result.exitCode}`;

        if (attempt < MAX_RETRIES && !abortController.signal.aborted) {
          console.log(`${simLabel} FAILED (attempt ${attempt + 1}/${MAX_RETRIES + 1}) in ${formatDuration(result.durationMs)}: ${errorMsg}, retrying in ${RETRY_DELAY_MS / 1000}s...`);
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));

          // Check if job was cancelled during backoff
          if (abortController.signal.aborted) {
            console.log(`${simLabel} Cancelled during retry backoff`);
            await reportSimulationStatus(jobId, simId, { state: 'CANCELLED' });
            return;
          }
          continue; // Retry
        }

        // All retries exhausted — report FAILED
        console.log(`${simLabel} FAILED in ${formatDuration(result.durationMs)} after ${attempt + 1} attempt(s): ${errorMsg}`);
        if (result.logText) {
          console.log(`${simLabel} Log preview (first 500 chars): ${result.logText.slice(0, 500)}`);
        }

        await reportSimulationStatus(jobId, simId, {
          state: 'FAILED',
          durationMs: result.durationMs,
          errorMessage: errorMsg,
        });
        return;
      }
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

// Has this worker already done its startup `?initial=1` heartbeat?
// Runtime concurrency overrides are delivered via the push API (POST /config
// on the worker's own HTTP server), so every subsequent heartbeat is a
// one-way status write and does NOT re-read the override from Firestore.
// We only do the read on the very first beat after startup so a worker that
// was offline while an override was set still picks it up.
let initialHeartbeatDone = false;

/**
 * Send a heartbeat to the API so the frontend knows this worker is online.
 * On the first call (after startup), requests the stored concurrency
 * override via `?initial=1`. Subsequent calls skip the override read.
 */
async function sendHeartbeat(status?: 'idle' | 'busy' | 'updating', timeoutMs?: number): Promise<void> {
  const isInitial = !initialHeartbeatDone;
  const url = `${getApiUrl()}/api/workers/heartbeat${isInitial ? '?initial=1' : ''}`;
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
      log.warn('Heartbeat failed', { status: res.status, statusText: res.statusText });
      return;
    }

    // Only the initial sync response carries an override; apply it exactly
    // once. After that, runtime changes arrive via the push /config path.
    if (isInitial && status !== 'updating') {
      const data = await res.json() as { ok: boolean; maxConcurrentOverride?: number };
      applyOverride(data.maxConcurrentOverride ?? null);
    } else {
      // Drain the response body so fetch doesn't leak the underlying
      // connection / stream when we don't care about the payload.
      await res.body?.cancel();
    }
    initialHeartbeatDone = true;
  } catch (err) {
    log.warn('Heartbeat error', { error: err instanceof Error ? err.message : err });
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
 * Re-pull the simulation image (fire-and-forget).
 * Called by the /pull-image push endpoint after a new image is published.
 */
function pullSimulationImage(): void {
  console.log('Pull-image request received, re-pulling simulation image...');
  ensureSimulationImage().catch((err) =>
    console.warn('Pull-image failed:', err instanceof Error ? err.message : err),
  );
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
// Polling Mode (HTTP claim-sim)
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

/**
 * Request a coverage job from the API when idle.
 * Returns true if a coverage job was created (will be picked up next poll cycle).
 */
let lastCoverageReason: string | null = null;

async function requestCoverageJob(): Promise<boolean> {
  try {
    const res = await fetch(`${getApiUrl()}/api/coverage/next-job`, {
      method: 'POST',
      headers: getApiHeaders(),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    if (res.status === 201) {
      const data = await res.json();
      console.log(`[Coverage] Requested coverage job: ${data.id}`);
      lastCoverageReason = null;
      return true;
    }
    if (res.status === 200) {
      const data = await res.json();
      const reason = data?.reason;
      if (reason && reason !== lastCoverageReason) {
        console.log(`[Coverage] No work: ${reason}`);
        lastCoverageReason = reason;
      }
    } else {
      console.warn(`[Coverage] Unexpected response: ${res.status}`);
    }
    return false;
  } catch (error) {
    if (error instanceof Error && error.name !== 'TimeoutError') {
      console.error('[Coverage] Error requesting coverage job:', error);
    }
    return false;
  }
}

/**
 * Polling loop: the worker's only source of work.
 *
 * For each available semaphore slot, ask the API to atomically claim the
 * next PENDING simulation. On success, process it in the background (fire-
 * and-forget) so the loop can immediately try to fill the next slot. On
 * 204 (no work), request a coverage job and then sleep until the push-
 * notify or the idle timeout wakes us.
 */
async function pollForSims(): Promise<void> {
  const IDLE_POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '3000', 10);

  console.log(`Polling ${getApiUrl()}/api/jobs/claim-sim (capacity=${localCapacity}, idle=${IDLE_POLL_INTERVAL_MS}ms)`);

  while (!isShuttingDown) {
    if (isDraining) {
      await waitForNotifyOrTimeout(IDLE_POLL_INTERVAL_MS);
      continue;
    }

    // Block until a semaphore slot is free — no point claiming work we
    // can't run. Resize-down paths already preempt excess in-flight sims.
    await simSemaphore!.acquire();

    let claimed: { jobId: string; simId: string; simIndex: number } | null = null;
    try {
      const claimUrl = new URL(`${getApiUrl()}/api/jobs/claim-sim`);
      claimUrl.searchParams.set('workerId', currentWorkerId);
      claimUrl.searchParams.set('workerName', currentWorkerName);
      const res = await fetch(claimUrl.toString(), {
        headers: getApiHeaders(),
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });
      if (res.status === 200) {
        claimed = (await res.json()) as { jobId: string; simId: string; simIndex: number };
      } else if (res.status !== 204) {
        console.warn(`claim-sim unexpected status ${res.status}`);
      }
    } catch (error) {
      if (error instanceof Error && error.name !== 'TimeoutError') {
        console.error('Polling error:', error);
        captureWorkerException(error, { component: 'polling-loop', workerId: currentWorkerId });
      }
    }

    if (!claimed) {
      simSemaphore!.release();
      const coverageCreated = await requestCoverageJob();
      if (coverageCreated) continue; // Try to claim the coverage sim immediately.
      await waitForNotifyOrTimeout(IDLE_POLL_INTERVAL_MS);
      continue;
    }

    const { jobId, simId, simIndex } = claimed;
    // Fire-and-forget so the loop can claim the next sim in parallel.
    // simSemaphore is released in the finally handler below.
    processSimulation(jobId, simId, simIndex)
      .catch(async (error) => {
        console.error(`Error processing simulation ${simId} for job ${jobId}:`, error);
        await reportSimulationStatus(jobId, simId, {
          state: 'FAILED',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
        });
      })
      .finally(() => simSemaphore!.release());
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

  // After the heartbeat (or timeout), close the worker API and exit.
  updatingHeartbeat.finally(() => {
    stopWorkerApi()
      .catch(() => {})
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

  currentWorkerName = getWorkerName();
  currentWorkerId = getWorkerId();
  log.info('Worker identity', { workerId: currentWorkerId, workerName: currentWorkerName });

  log.info('Worker starting');
  log.info('Mode', { mode: 'Per-Simulation (docker run --rm)' });
  log.info('API URL', { url: getApiUrl() });
  log.info('Simulation image', { image: SIMULATION_IMAGE });

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
    onPullImage: pullSimulationImage,
    getHealth: (): HealthStatus => ({ ok: true }),
  });

  // Initial heartbeat (await to apply override before polling starts)
  await sendHeartbeat();
  // 60s default: the heartbeat exists only so the frontend can show "worker
  // online" within ~1-2 minutes. More frequent beats burned Firestore writes
  // and kept the API container warm 24/7 (defeating minInstances: 0) with
  // 2 workers beating every 15s → 11,520 writes/day.
  const HEARTBEAT_INTERVAL_MS = parseInt(process.env.HEARTBEAT_INTERVAL_MS || '60000', 10);
  heartbeatInterval = setInterval(() => sendHeartbeat(), HEARTBEAT_INTERVAL_MS);

  // Periodic Docker cleanup (every hour) to free disk space
  dockerCleanupInterval = setInterval(() => {
    console.log('Periodic Docker cleanup...');
    pruneDockerResources().catch((err) =>
      console.warn('Periodic Docker cleanup error:', err instanceof Error ? err.message : err),
    );
  }, 60 * 60 * 1000);

  console.log('Worker is running in polling mode.');
  await pollForSims();
}

main().catch(async (error) => {
  log.error('Failed to start', { error: error instanceof Error ? error.message : String(error) });
  captureWorkerException(error, { component: 'worker-startup' });
  await flushSentry();
  process.exit(1);
});
