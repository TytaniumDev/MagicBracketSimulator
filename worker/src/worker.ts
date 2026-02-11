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
 * Unified Worker: Runs forge simulations via Pub/Sub (GCP) or polling (local)
 *
 * This worker:
 * 1. Loads config from Google Secret Manager (if GOOGLE_CLOUD_PROJECT set) or env
 * 2. Receives jobs via Pub/Sub (if PUBSUB_SUBSCRIPTION set) or polls GET /api/jobs/next
 * 3. Fetches job details from the API
 * 4. Runs forge simulations as child processes (parallel)
 * 5. POSTs raw logs + deck metadata to orchestrator API
 * 6. Acknowledges the Pub/Sub message (or polls for next job) when complete
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

// ============================================================================
// Configuration
// ============================================================================

// Path to forge installation (set by unified container or local install)
const FORGE_PATH = process.env.FORGE_PATH || '/app/forge';

// Reserve ~2GB for system + worker overhead
const SYSTEM_RESERVE_MB = 2048;
// Each Forge sim needs ~500-600MB RAM
const RAM_PER_SIM_MB = 600;

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
      if (value !== undefined && value !== '' && process.env[key] === undefined) {
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

/**
 * Fetch job details from API
 */
async function fetchJob(jobId: string): Promise<JobData | null> {
  const API_URL = process.env.API_URL || 'http://localhost:3000';
  const AUTH_TOKEN = process.env.AUTH_TOKEN || '';
  const WORKER_SECRET = process.env.WORKER_SECRET || '';
  const url = `${API_URL}/api/jobs/${jobId}`;
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };
  if (AUTH_TOKEN) {
    (headers as Record<string, string>)['Authorization'] = `Bearer ${AUTH_TOKEN}`;
  }
  if (WORKER_SECRET) {
    (headers as Record<string, string>)['X-Worker-Secret'] = WORKER_SECRET;
  }

  try {
    const response = await fetch(url, { headers });
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
async function patchJobStatus(jobId: string, status: string, errorMessage?: string): Promise<void> {
  const API_URL = process.env.API_URL || 'http://localhost:3000';
  const AUTH_TOKEN = process.env.AUTH_TOKEN || '';
  const WORKER_SECRET = process.env.WORKER_SECRET || '';
  const url = `${API_URL}/api/jobs/${jobId}`;
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };
  if (AUTH_TOKEN) {
    (headers as Record<string, string>)['Authorization'] = `Bearer ${AUTH_TOKEN}`;
  }
  if (WORKER_SECRET) {
    (headers as Record<string, string>)['X-Worker-Secret'] = WORKER_SECRET;
  }

  const body: Record<string, unknown> = { status };
  if (errorMessage) {
    body.errorMessage = errorMessage;
  }

  try {
    const response = await fetch(url, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      console.error(`Failed to update job status: ${response.status}`);
    }
  } catch (error) {
    console.error(`Error updating job status:`, error);
  }
}

// ============================================================================
// Deck cache (for deckIds path: on-demand fetch, shared cache, no jobDir/decks)
// ============================================================================

const DECK_CACHE_DIR = process.env.DECK_CACHE_DIR || path.resolve(process.cwd(), 'deck-cache');

/**
 * Sanitize deck ID to a safe .dck filename (no path chars).
 * IDs are often "precon-id" or "doran-big-butts.dck"; use as-is if safe, else slugify.
 */
function sanitizeDeckIdToFilename(deckId: string): string {
  const trimmed = deckId.trim();
  if (!trimmed) return 'deck.dck';
  // If it looks like a filename (ends with .dck, no path chars), use as-is
  if (trimmed.endsWith('.dck') && !trimmed.includes('/') && !trimmed.includes('\\') && !trimmed.includes('..')) {
    return trimmed;
  }
  // Slugify: lowercase, replace non-alnum with hyphen, ensure .dck
  const slug = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 100) || 'deck';
  return slug.endsWith('.dck') ? slug : `${slug}.dck`;
}

/**
 * Fetch deck content from orchestrator (worker auth).
 */
async function fetchDeckContent(deckId: string): Promise<{ name: string; dck: string } | null> {
  const API_URL = process.env.API_URL || 'http://localhost:3000';
  const WORKER_SECRET = process.env.WORKER_SECRET || '';
  const AUTH_TOKEN = process.env.AUTH_TOKEN || '';
  const url = `${API_URL}/api/decks/${encodeURIComponent(deckId)}/content`;
  const headers: HeadersInit = { 'Content-Type': 'application/json' };
  if (AUTH_TOKEN) {
    (headers as Record<string, string>)['Authorization'] = `Bearer ${AUTH_TOKEN}`;
  }
  if (WORKER_SECRET) {
    (headers as Record<string, string>)['X-Worker-Secret'] = WORKER_SECRET;
  }
  try {
    const response = await fetch(url, { headers });
    if (!response.ok) return null;
    return (await response.json()) as { name: string; dck: string };
  } catch {
    return null;
  }
}

/**
 * Ensure deck is in cache; fetch on miss. Returns name and cache filename.
 * Stores deck name in a sidecar .name file for when we read from cache later.
 */
async function ensureDeckInCache(deckId: string): Promise<{ name: string; cacheFilename: string }> {
  await fs.mkdir(DECK_CACHE_DIR, { recursive: true });
  const cacheFilename = sanitizeDeckIdToFilename(deckId);
  const dckPath = path.join(DECK_CACHE_DIR, cacheFilename);
  const namePath = path.join(DECK_CACHE_DIR, `${cacheFilename}.name`);

  const existingDck = await fs.readFile(dckPath, 'utf-8').catch(() => null);
  if (existingDck !== null) {
    const name = await fs.readFile(namePath, 'utf-8').catch(() => null);
    return { name: (name?.trim()) || cacheFilename.replace(/\.dck$/, ''), cacheFilename };
  }

  const content = await fetchDeckContent(deckId);
  if (!content) {
    throw new Error(`Failed to fetch deck content for ${deckId}`);
  }
  await fs.writeFile(dckPath, content.dck, 'utf-8');
  await fs.writeFile(namePath, content.name, 'utf-8');
  return { name: content.name, cacheFilename };
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

/**
 * Split simulations across parallel runs
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
        console.error(`Process timed out after ${options.timeout}ms, killing...`);
        proc.kill('SIGTERM');
        setTimeout(() => proc.kill('SIGKILL'), 5000);
      }, options.timeout);
    }

    proc.on('error', (error) => {
      if (timeoutId) clearTimeout(timeoutId);
      reject(error);
    });

    proc.on('close', (code) => {
      if (timeoutId) clearTimeout(timeoutId);
      resolve({ exitCode: code || 0, duration: Date.now() - startTime });
    });
  });
}

/**
 * Run forge simulation as a child process.
 * When deckFilenames is provided, decksDir is the cache (or any dir containing those files); otherwise jobDir/decks with deck_0.dck ... deck_3.dck.
 */
async function runForgeSim(
  jobDir: string,
  simulations: number,
  runId: string,
  options?: { decksDir: string; deckFilenames: [string, string, string, string] }
): Promise<ProcessResult> {
  const decksDir = options?.decksDir ?? path.resolve(jobDir, 'decks');
  const logsDir = path.resolve(jobDir, 'logs');
  const [d0, d1, d2, d3] = options?.deckFilenames ?? ['deck_0.dck', 'deck_1.dck', 'deck_2.dck', 'deck_3.dck'];
  // Unique RUN_DECKS_DIR per run so parallel forge runs don't race (symlinks in run_sim.sh)
  const runDecksDir = path.resolve(jobDir, 'run-decks', runId);
  const runSimScript = path.join(FORGE_PATH, 'run_sim.sh');

  const args = [
    '--decks',
    d0,
    d1,
    d2,
    d3,
    '--simulations',
    String(simulations),
    '--id',
    runId,
  ];

  return runProcess('/bin/bash', [runSimScript, ...args], {
    env: {
      DECKS_DIR: decksDir,
      LOGS_DIR: logsDir,
      RUN_DECKS_DIR: runDecksDir,
    },
    timeout: 10 * 60 * 1000, // 10 minute timeout
  });
}

// ============================================================================
// Log Processing (replaces misc-runner container)
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
    // Read all files in logs directory
    const allFiles = await fs.readdir(logsDir);
    // Filter for txt files matching job ID (excluding deck_names.txt)
    files = allFiles
      .filter((f) => f.includes(jobId) && f.endsWith('.txt') && f !== 'deck_names.txt')
      .map((f) => path.join(logsDir, f))
      .sort();
  } catch {
    // Directory might not exist
  }

  // If no files match with job ID, try to find any .txt files (except deck_names.txt)
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
      // Check if this file contains multiple concatenated games
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
 * Process logs and POST to orchestrator API (replaces GCS upload)
 */
async function processAndUploadLogs(
  jobId: string,
  logsDir: string,
  deckLists: string[]
): Promise<void> {
  const API_URL = process.env.API_URL || 'http://localhost:3000';
  const AUTH_TOKEN = process.env.AUTH_TOKEN || '';
  const WORKER_SECRET = process.env.WORKER_SECRET || '';

  console.log('Reading game logs...');
  const { rawLogs, deckNames } = await readGameLogs(logsDir, jobId);
  console.log(`Found ${rawLogs.length} game logs`);

  if (rawLogs.length === 0) {
    throw new Error('No game logs found');
  }

  console.log(`POSTing ${rawLogs.length} game logs to orchestrator API...`);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (AUTH_TOKEN) headers['Authorization'] = `Bearer ${AUTH_TOKEN}`;
  if (WORKER_SECRET) headers['X-Worker-Secret'] = WORKER_SECRET;

  const response = await fetch(`${API_URL}/api/jobs/${jobId}/logs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ gameLogs: rawLogs, deckNames, deckLists }),
  });

  if (!response.ok) {
    throw new Error(`Failed to POST logs for job ${jobId}: ${response.status} ${response.statusText}`);
  }

  console.log('Logs posted successfully');
}

// ============================================================================
// Job Processing
// ============================================================================

/**
 * Process a single job
 */
async function processJob(jobId: string): Promise<void> {
  console.log(`Processing job ${jobId}...`);

  // Fetch job details
  const job = await fetchJob(jobId);
  if (!job) {
    throw new Error(`Job ${jobId} not found`);
  }

  // Skip if not queued (might have been processed already)
  if (job.status !== 'QUEUED') {
    console.log(`Job ${jobId} is not QUEUED (status: ${job.status}), skipping`);
    return;
  }

  // Update status to RUNNING
  await patchJobStatus(jobId, 'RUNNING');

  const JOBS_DIR = process.env.JOBS_DIR || './jobs';
  const jobDir = path.join(JOBS_DIR, jobId);
  const logsDir = path.join(jobDir, 'logs');
  await fs.mkdir(logsDir, { recursive: true });

  let deckNames: string[];
  let deckLists: string[];
  let runForgeOptions: { decksDir: string; deckFilenames: [string, string, string, string] } | undefined;

  if (job.deckIds && job.deckIds.length === 4) {
    // Deck IDs path: ensure all 4 in cache, use cache for run_sim (no jobDir/decks)
    console.log('Using deck cache for deck IDs:', job.deckIds.join(', '));
    const resolved = await Promise.all(job.deckIds.map((id) => ensureDeckInCache(id)));
    deckNames = resolved.map((r) => r.name);
    const cacheFilenames = resolved.map((r) => r.cacheFilename) as [string, string, string, string];
    runForgeOptions = { decksDir: DECK_CACHE_DIR, deckFilenames: cacheFilenames };
    deckLists = await Promise.all(
      cacheFilenames.map((f) => fs.readFile(path.join(DECK_CACHE_DIR, f), 'utf-8'))
    );
  } else if (job.decks && job.decks.length === 4) {
    // Full decks path (backward compat): write jobDir/decks, use default filenames
    const decksDir = path.join(jobDir, 'decks');
    await fs.mkdir(decksDir, { recursive: true });
    try {
      await fs.chmod(decksDir, 0o777);
      await fs.chmod(logsDir, 0o777);
    } catch {
      // Ignore permission errors on Windows
    }
    await Promise.all(
      job.decks.map((deck, i) => {
        const deckPath = path.join(decksDir, `deck_${i}.dck`);
        return fs.writeFile(deckPath, deck.dck, 'utf-8');
      })
    );
    deckNames = job.decks.map((d) => d.name);
    deckLists = job.decks.map((d) => d.dck);
  } else {
    throw new Error('Job must have either deckIds (length 4) or decks (length 4)');
  }

  const deckNamesPath = path.join(logsDir, 'deck_names.txt');
  await fs.writeFile(deckNamesPath, deckNames.join('\n'), 'utf-8');

  // Calculate dynamic parallelism based on system resources
  const requestedParallelism = job.parallelism || 4;
  const parallelism = calculateDynamicParallelism(requestedParallelism);
  const runs = splitSimulations(job.simulations, parallelism);
  console.log(`Running ${runs.length} parallel simulations: ${runs.join(', ')}`);

  // Run forge simulations in parallel
  const forgeResults = await Promise.all(
    runs.map((sims, idx) =>
      runForgeSim(jobDir, sims, `job_${jobId}_run${idx}`, runForgeOptions)
    )
  );

  // Check for failures
  const failedRuns = forgeResults.filter((r) => r.exitCode !== 0);
  if (failedRuns.length > 0) {
    throw new Error(`${failedRuns.length} forge simulation runs failed`);
  }

  const durations = forgeResults.map((r) => r.duration);
  console.log(`Forge simulations completed in: ${durations.map((d) => `${d}ms`).join(', ')}`);

  // Process logs and POST to orchestrator API
  console.log(`Processing and posting logs for job ${jobId}...`);
  await processAndUploadLogs(jobId, logsDir, deckLists);

  // Clean up per-run deck dirs (ephemeral copies; not reused)
  const runDecksParent = path.join(jobDir, 'run-decks');
  try {
    await fs.rm(runDecksParent, { recursive: true });
  } catch (err) {
    console.warn(`Could not remove run-decks for job ${jobId}:`, err);
  }

  // Update job status to COMPLETED
  await patchJobStatus(jobId, 'COMPLETED');

  console.log(`Job ${jobId} completed successfully`);
}

// ============================================================================
// Pub/Sub Message Handlers
// ============================================================================

/**
 * Handle a Pub/Sub message
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
  const API_URL = process.env.API_URL || 'http://localhost:3000';
  const WORKER_SECRET = process.env.WORKER_SECRET || '';
  const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '3000', 10);

  console.log(`Polling for jobs at ${API_URL}/api/jobs/next every ${POLL_INTERVAL_MS}ms...`);

  while (!isShuttingDown) {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (WORKER_SECRET) headers['X-Worker-Secret'] = WORKER_SECRET;

      const res = await fetch(`${API_URL}/api/jobs/next`, { headers });
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

  const API_URL = process.env.API_URL || 'http://localhost:3000';
  const JOBS_DIR = process.env.JOBS_DIR || './jobs';
  const usePubSub = !!process.env.PUBSUB_SUBSCRIPTION;

  const workerId = await getOrCreateWorkerId(JOBS_DIR);
  console.log('Worker ID:', workerId.slice(0, 8) + '...');

  console.log('Worker starting...');
  console.log('Mode:', usePubSub ? 'Pub/Sub' : 'Polling');
  console.log('API URL:', API_URL);
  console.log('Jobs directory:', JOBS_DIR);
  console.log('Forge path:', FORGE_PATH);

  // Ensure jobs directory exists
  await fs.mkdir(JOBS_DIR, { recursive: true });

  if (usePubSub) {
    const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'magic-bracket-simulator';
    const SUBSCRIPTION_NAME = process.env.PUBSUB_SUBSCRIPTION!;

    const { PubSub } = await import('@google-cloud/pubsub');
    const pubsub = new PubSub({ projectId: PROJECT_ID });
    subscription = pubsub.subscription(SUBSCRIPTION_NAME);

    console.log('Project:', PROJECT_ID);
    console.log('Subscription:', SUBSCRIPTION_NAME);
    console.log('Subscribing to Pub/Sub messages...');

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
