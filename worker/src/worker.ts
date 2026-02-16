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
 * Worker Orchestrator: Manages simulations via Docker Swarm services
 *
 * This worker:
 * 1. Loads config from Google Secret Manager (if GOOGLE_CLOUD_PROJECT set) or env
 * 2. Receives jobs via Pub/Sub (if PUBSUB_SUBSCRIPTION set) or polls GET /api/jobs/next
 * 3. Fetches job details from the API
 * 4. Creates one-shot Swarm services per simulation (decks via base64 env vars)
 * 5. Polls for completion, collects logs via `docker service logs`
 * 6. Reports per-simulation progress to the API
 * 7. Condenses logs and POSTs to the API
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import {
  JobData,
  JobCreatedMessage,
} from './types.js';
import {
  splitConcatenatedGames,
} from './condenser.js';
import { runProcess } from './process.js';
import {
  verifySwarmActive,
  calculateSwarmCapacity,
  runSimulationSwarmService,
  cleanupSwarmServices,
  SwarmSimulationResult,
} from './swarm-orchestrator.js';

const SECRET_NAME = 'simulation-worker-config';
const WORKER_ID_FILE = 'worker-id';

// Module-scoped worker ID and name, set in main() after initialization
let currentWorkerId = '';
let currentWorkerName = '';

// Heartbeat tracking
let heartbeatJobId: string | undefined;
let activeSimCount = 0;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
const workerStartTime = Date.now();

// ============================================================================
// Worker Naming
// ============================================================================

const WORKER_ADJECTIVES = [
  'Arcane', 'Blazing', 'Crimson', 'Dark', 'Eldritch', 'Fierce', 'Golden',
  'Hallowed', 'Infernal', 'Jade', 'Keen', 'Lunar', 'Mystic', 'Noble',
  'Obsidian', 'Primal', 'Radiant', 'Shadow', 'Titanic', 'Undying',
  'Verdant', 'Wicked', 'Ancient', 'Burning', 'Celestial', 'Dread',
  'Ethereal', 'Feral', 'Ghostly', 'Hollow', 'Iron', 'Jeweled',
  'Kindled', 'Lifeless', 'Molten', 'Nether', 'Omen', 'Phantom',
  'Quicksilver', 'Rune', 'Storm', 'Thunder', 'Umbral', 'Void',
  'Wild', 'Zealous', 'Amber', 'Brazen', 'Crystal',
];

const WORKER_NOUNS = [
  'Phoenix', 'Golem', 'Dragon', 'Sphinx', 'Hydra', 'Wurm', 'Angel',
  'Demon', 'Elemental', 'Knight', 'Shaman', 'Wizard', 'Titan', 'Specter',
  'Griffin', 'Serpent', 'Colossus', 'Sentinel', 'Oracle', 'Revenant',
  'Behemoth', 'Leviathan', 'Basilisk', 'Chimera', 'Djinn', 'Gargoyle',
  'Juggernaut', 'Kraken', 'Manticore', 'Nightmare', 'Ogre', 'Paladin',
  'Ranger', 'Scion', 'Templar', 'Unicorn', 'Valkyrie', 'Wraith',
  'Archon', 'Banshee', 'Centaur', 'Drake', 'Falcon', 'Herald',
  'Invoker', 'Mage', 'Nomad', 'Outcast', 'Rogue', 'Thane',
];

/**
 * Generate a deterministic two-word name from a worker ID.
 * Hash-based so it's stable across restarts with the same ID.
 */
function generateWorkerName(workerId: string): string {
  let hash = 0;
  for (let i = 0; i < workerId.length; i++) {
    hash = ((hash << 5) - hash + workerId.charCodeAt(i)) | 0;
  }
  // Use absolute value to handle negative hashes
  const h = Math.abs(hash);
  const adj = WORKER_ADJECTIVES[h % WORKER_ADJECTIVES.length];
  const noun = WORKER_NOUNS[Math.floor(h / WORKER_ADJECTIVES.length) % WORKER_NOUNS.length];
  return `${adj}${noun}`;
}

/**
 * Get the worker's display name.
 * Priority: WORKER_NAME env var > auto-generated from worker ID > hostname
 */
function getWorkerName(workerId: string): string {
  const envName = process.env.WORKER_NAME?.trim();
  if (envName && envName.length > 0) return envName;
  if (workerId) return generateWorkerName(workerId);
  return os.hostname();
}

// ============================================================================
// Configuration
// ============================================================================

const SIMULATION_IMAGE = process.env.SIMULATION_IMAGE || 'ghcr.io/tytaniumdev/magicbracketsimulator/simulation:latest';
const JOBS_DIR = process.env.JOBS_DIR || '/tmp/mbs-jobs';

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
 * Fetch just the job status from API (lightweight check for cancellation).
 */
async function fetchJobStatus(jobId: string): Promise<string | null> {
  const url = `${getApiUrl()}/api/jobs/${jobId}`;
  try {
    const response = await fetch(url, { headers: getApiHeaders() });
    if (response.status === 404) return null;
    if (!response.ok) return null;
    const data = await response.json();
    return data.status ?? null;
  } catch {
    return null;
  }
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
  if (status === 'RUNNING' && currentWorkerId) {
    body.workerId = currentWorkerId;
    body.workerName = currentWorkerName;
  }

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
// Log Processing
// ============================================================================

/**
 * Extract individual game logs from collected service log text.
 * Each simulation service produces one game's worth of log output.
 * We use splitConcatenatedGames to handle any multi-game output.
 */
function extractGameLogs(logTexts: string[]): string[] {
  const rawLogs: string[] = [];
  for (const logText of logTexts) {
    if (!logText.trim()) continue;
    const games = splitConcatenatedGames(logText);
    rawLogs.push(...games);
  }
  return rawLogs;
}

/**
 * POST condensed game logs to the API
 */
async function uploadLogs(
  jobId: string,
  rawLogs: string[],
  deckNames: string[],
  deckLists: string[],
): Promise<void> {
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
// Job Processing — Swarm Mode
// ============================================================================

/**
 * Process a job by creating one-shot Swarm services per simulation.
 * Deck content is base64-encoded into env vars — no shared filesystem needed.
 */
async function processJobWithSwarm(jobId: string, job: JobData): Promise<void> {
  const totalSims = job.simulations;
  const capacity = await calculateSwarmCapacity(totalSims);

  const deckFilenames: [string, string, string, string] = ['deck_0.dck', 'deck_1.dck', 'deck_2.dck', 'deck_3.dck'];
  const deckContents: [string, string, string, string] = [
    job.decks![0].dck,
    job.decks![1].dck,
    job.decks![2].dck,
    job.decks![3].dck,
  ];
  const deckNames = job.decks!.map((d) => d.name);
  const deckLists = job.decks!.map((d) => d.dck);

  // Initialize per-simulation tracking in the API
  await apiInitializeSimulations(jobId, totalSims);

  // Generate simulation IDs
  const simIds = Array.from({ length: totalSims }, (_, i) => ({
    simId: `sim_${String(i).padStart(3, '0')}`,
    index: i,
  }));

  console.log(`Running ${totalSims} simulations with concurrency=${capacity}`);

  // Cancellation polling: cache result for 5s to avoid hammering API
  let cancelledCache: { value: boolean; at: number } = { value: false, at: 0 };
  const checkCancelled = async (): Promise<boolean> => {
    const now = Date.now();
    if (now - cancelledCache.at < 5000) return cancelledCache.value;
    const status = await fetchJobStatus(jobId);
    const isCancelled = status === null || status === 'CANCELLED';
    cancelledCache = { value: isCancelled, at: now };
    if (isCancelled) console.log(`Job ${jobId} has been cancelled or deleted`);
    return isCancelled;
  };

  // Run simulations with bounded concurrency
  const semaphore = new Semaphore(capacity);
  const results: SwarmSimulationResult[] = [];
  let completedCount = 0;

  await Promise.all(
    simIds.map(async ({ simId, index }) => {
      await semaphore.acquire();
      try {
        // Check cancellation before starting
        if (await checkCancelled()) {
          await reportSimulationStatus(jobId, simId, { state: 'CANCELLED' }).catch(() => {});
          return;
        }

        // Report RUNNING
        activeSimCount++;
        await reportSimulationStatus(jobId, simId, {
          state: 'RUNNING',
          workerId: currentWorkerId,
          workerName: currentWorkerName,
        });

        const result = await runSimulationSwarmService(
          jobId, simId, index, deckContents, deckFilenames, checkCancelled
        );
        results.push(result);

        // Report final state
        if (result.exitCode === 0) {
          await reportSimulationStatus(jobId, simId, {
            state: 'COMPLETED',
            durationMs: result.durationMs,
          });
        } else {
          await reportSimulationStatus(jobId, simId, {
            state: 'FAILED',
            durationMs: result.durationMs,
            errorMessage: result.error || `Exit code ${result.exitCode}`,
          });
        }

        // Update job-level progress
        completedCount++;
        activeSimCount = Math.max(0, activeSimCount - 1);
        await updateJobProgress(jobId, completedCount);
      } finally {
        semaphore.release();
      }
    })
  );

  // If cancelled, skip log upload and status update
  if (await checkCancelled()) {
    console.log(`Job ${jobId} was cancelled — skipping log upload and status update`);
    return;
  }

  // Check for complete failure
  const succeeded = results.filter((r) => r.exitCode === 0);
  const failed = results.filter((r) => r.exitCode !== 0);

  const durations = results.map((r) => r.durationMs);
  console.log(`Simulations completed: ${succeeded.length} succeeded, ${failed.length} failed`);
  console.log(`Durations: ${durations.map((d) => `${d}ms`).join(', ')}`);

  if (succeeded.length === 0) {
    throw new Error(`All ${totalSims} simulations failed`);
  }

  // Collect and condense logs from service log output
  const logTexts = succeeded.map((r) => r.logText);
  const rawLogs = extractGameLogs(logTexts);
  console.log(`Extracted ${rawLogs.length} game logs from ${succeeded.length} simulations`);

  if (rawLogs.length === 0) {
    throw new Error('No game logs found in simulation output');
  }

  await uploadLogs(jobId, rawLogs, deckNames, deckLists);

  // Update job status to COMPLETED
  await patchJobStatus(jobId, 'COMPLETED', undefined, durations);

  console.log(`Job ${jobId} completed successfully`);
}

// ============================================================================
// Job Processing (dispatcher)
// ============================================================================

/**
 * Process a single job via Swarm services
 */
async function processJob(jobId: string): Promise<void> {
  console.log(`Processing job ${jobId}...`);

  const job = await fetchJob(jobId);
  if (!job) {
    throw new Error(`Job ${jobId} not found`);
  }

  if (job.status !== 'QUEUED') {
    console.log(`Job ${jobId} is not QUEUED (status: ${job.status}), skipping`);
    return;
  }

  if (!job.decks || job.decks.length !== 4) {
    throw new Error('Job must have exactly 4 decks with full content');
  }

  heartbeatJobId = jobId;
  await patchJobStatus(jobId, 'RUNNING');
  try {
    await processJobWithSwarm(jobId, job);
  } finally {
    heartbeatJobId = undefined;
    activeSimCount = 0;
  }
}

// ============================================================================
// Heartbeat
// ============================================================================

/**
 * Send a heartbeat to the API so the frontend knows this worker is online.
 */
async function sendHeartbeat(capacity: number): Promise<void> {
  const url = `${getApiUrl()}/api/workers/heartbeat`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: getApiHeaders(),
      body: JSON.stringify({
        workerId: currentWorkerId,
        workerName: currentWorkerName,
        status: heartbeatJobId ? 'busy' : 'idle',
        currentJobId: heartbeatJobId,
        capacity,
        activeSimulations: activeSimCount,
        uptimeMs: Date.now() - workerStartTime,
      }),
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
 * Multiple jobs can run concurrently since each simulation runs as an
 * isolated Swarm service with no shared filesystem.
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

  // Stop heartbeat
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }

  // Clean up orphaned swarm services
  cleanupSwarmServices()
    .catch((err) => console.warn('Swarm cleanup error:', err))
    .then(() => {
      const closeJobSub = subscription ? subscription.close() : Promise.resolve();
      return closeJobSub;
    })
    .then(() => {
      console.log('Shutdown complete');
      process.exit(0);
    })
    .catch((error: unknown) => {
      console.error('Error during shutdown:', error);
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
  currentWorkerName = getWorkerName(currentWorkerId);
  console.log('Worker ID:', currentWorkerId.slice(0, 8) + '...');
  console.log('Worker Name:', currentWorkerName);

  console.log('Worker starting...');
  console.log('Mode: Swarm Orchestrator');
  console.log('Transport:', usePubSub ? 'Pub/Sub' : 'Polling');
  console.log('API URL:', getApiUrl());
  console.log('Simulation image:', SIMULATION_IMAGE);

  // Verify swarm is active before accepting jobs
  await verifySwarmActive();

  // Pre-pull simulation image on this node
  await ensureSimulationImage();

  // Start heartbeat interval (every 15 seconds)
  const heartbeatCapacity = await calculateSwarmCapacity(16);
  sendHeartbeat(heartbeatCapacity); // Initial heartbeat
  heartbeatInterval = setInterval(() => sendHeartbeat(heartbeatCapacity), 15_000);

  if (usePubSub) {
    const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'magic-bracket-simulator';
    const SUBSCRIPTION_NAME = process.env.PUBSUB_SUBSCRIPTION!;

    const { PubSub } = await import('@google-cloud/pubsub');
    const pubsub = new PubSub({ projectId: PROJECT_ID });

    // Allow multiple concurrent jobs — each simulation is an isolated swarm service
    const maxMessages = await calculateSwarmCapacity(16);

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
