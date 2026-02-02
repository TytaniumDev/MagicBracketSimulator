/**
 * Local Worker: Pulls jobs from Pub/Sub and orchestrates Docker containers
 * 
 * This worker:
 * 1. Pulls job-created messages from Pub/Sub
 * 2. Fetches job details from the API
 * 3. Runs forge-sim container(s) to simulate games
 * 4. Runs misc-runner container to condense logs and upload to GCS
 * 5. Acknowledges the message when complete
 */

import { PubSub, Message } from '@google-cloud/pubsub';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';

// Configuration from environment
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'magic-bracket-simulator';
const SUBSCRIPTION_NAME = process.env.PUBSUB_SUBSCRIPTION || 'job-created-worker';
const API_URL = process.env.API_URL || 'http://localhost:3000';
const GCS_BUCKET = process.env.GCS_BUCKET || 'magic-bracket-simulator-artifacts';
const JOBS_DIR = process.env.JOBS_DIR || './jobs';
const FORGE_SIM_IMAGE = process.env.FORGE_SIM_IMAGE || 'forge-sim:latest';
const MISC_RUNNER_IMAGE = process.env.MISC_RUNNER_IMAGE || 'misc-runner:latest';
const AUTH_TOKEN = process.env.AUTH_TOKEN || '';
const SA_KEY_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS || '';

// Types
interface JobData {
  id: string;
  decks: Array<{ name: string; dck: string }>;
  simulations: number;
  parallelism: number;
  status: string;
}

interface JobCreatedMessage {
  jobId: string;
  createdAt: string;
}

// Initialize Pub/Sub client
const pubsub = new PubSub({ projectId: PROJECT_ID });
const subscription = pubsub.subscription(SUBSCRIPTION_NAME);

console.log(`Local Worker starting...`);
console.log(`Project: ${PROJECT_ID}`);
console.log(`Subscription: ${SUBSCRIPTION_NAME}`);
console.log(`API URL: ${API_URL}`);
console.log(`Jobs directory: ${JOBS_DIR}`);

/**
 * Fetch job details from API
 */
async function fetchJob(jobId: string): Promise<JobData | null> {
  const url = `${API_URL}/api/jobs/${jobId}`;
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };
  if (AUTH_TOKEN) {
    headers['Authorization'] = `Bearer ${AUTH_TOKEN}`;
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
  const url = `${API_URL}/api/jobs/${jobId}`;
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };
  if (AUTH_TOKEN) {
    headers['Authorization'] = `Bearer ${AUTH_TOKEN}`;
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

  return runs.filter(n => n > 0);
}

/**
 * Run a Docker container and wait for it to complete
 */
function runDocker(args: string[]): Promise<{ exitCode: number; duration: number }> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    // Determine command and args based on platform
    let command = 'docker';
    let commandArgs = args;

    // On macOS, use caffeinate to prevent sleep during execution
    if (process.platform === 'darwin') {
      command = 'caffeinate';
      commandArgs = ['-i', 'docker', ...args];
    }

    console.log(`Running: ${command} ${commandArgs.join(' ')}`);

    // Handle Windows/WSL path issues
    const env = { ...process.env, MSYS_NO_PATHCONV: '1' };

    const proc: ChildProcess = spawn(command, commandArgs, {
      stdio: 'inherit',
      env,
    });

    proc.on('error', (error) => {
      reject(error);
    });

    proc.on('close', (code) => {
      const duration = Date.now() - startTime;
      resolve({ exitCode: code || 0, duration });
    });
  });
}

/**
 * Run forge-sim container
 */
async function runForgeSim(
  jobDir: string,
  simulations: number,
  runId: string
): Promise<{ exitCode: number; duration: number }> {
  const decksDir = path.resolve(jobDir, 'decks');
  const logsDir = path.resolve(jobDir, 'logs');

  const args = [
    'run', '--rm',
    '-v', `${decksDir}:/app/decks`,
    '-v', `${logsDir}:/app/logs`,
    FORGE_SIM_IMAGE,
    '--decks', 'deck_0.dck', 'deck_1.dck', 'deck_2.dck', 'deck_3.dck',
    '--simulations', String(simulations),
    '--id', runId,
  ];

  return runDocker(args);
}

/**
 * Run misc-runner container
 */
async function runMiscRunner(jobId: string, jobDir: string): Promise<{ exitCode: number; duration: number }> {
  const logsDir = path.resolve(jobDir, 'logs');

  const args = [
    'run', '--rm',
    '-v', `${logsDir}:/app/logs:ro`,
    '-e', `JOB_ID=${jobId}`,
    '-e', `API_URL=${API_URL}`,
    '-e', `GCS_BUCKET=${GCS_BUCKET}`,
    '-e', `LOGS_DIR=/app/logs`,
  ];

  // Add service account credentials if available
  if (SA_KEY_PATH) {
    args.push('-e', `GOOGLE_APPLICATION_CREDENTIALS=/secrets/sa.json`);
    args.push('-v', `${SA_KEY_PATH}:/secrets/sa.json:ro`);
  }

  if (AUTH_TOKEN) {
    args.push('-e', `AUTH_TOKEN=${AUTH_TOKEN}`);
  }

  args.push(MISC_RUNNER_IMAGE);

  return runDocker(args);
}

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

  // Create job directories
  const jobDir = path.join(JOBS_DIR, jobId);
  const decksDir = path.join(jobDir, 'decks');
  const logsDir = path.join(jobDir, 'logs');

  await fs.mkdir(decksDir, { recursive: true });
  await fs.mkdir(logsDir, { recursive: true });

  // Set permissions for Docker (Linux/WSL)
  try {
    await fs.chmod(decksDir, 0o777);
    await fs.chmod(logsDir, 0o777);
  } catch {
    // Ignore permission errors on Windows
  }

  // Write deck files
  for (let i = 0; i < job.decks.length; i++) {
    const deckPath = path.join(decksDir, `deck_${i}.dck`);
    await fs.writeFile(deckPath, job.decks[i].dck, 'utf-8');
  }

  // Write deck names for misc-runner
  const deckNamesPath = path.join(logsDir, 'deck_names.txt');
  await fs.writeFile(deckNamesPath, job.decks.map(d => d.name).join('\n'), 'utf-8');

  // Run forge-sim container(s) in parallel
  const parallelism = job.parallelism || 4;
  const runs = splitSimulations(job.simulations, parallelism);
  console.log(`Running ${runs.length} parallel simulations: ${runs.join(', ')}`);

  const forgeResults = await Promise.all(
    runs.map((sims, idx) =>
      runForgeSim(jobDir, sims, `job_${jobId}_run${idx}`)
    )
  );

  // Check for failures
  const failedRuns = forgeResults.filter(r => r.exitCode !== 0);
  if (failedRuns.length > 0) {
    throw new Error(`${failedRuns.length} forge-sim runs failed`);
  }

  const durations = forgeResults.map(r => r.duration);
  console.log(`Forge simulations completed in: ${durations.map(d => `${d}ms`).join(', ')}`);

  // Run misc-runner container
  console.log(`Running misc-runner for job ${jobId}...`);
  const miscResult = await runMiscRunner(jobId, jobDir);

  if (miscResult.exitCode !== 0) {
    throw new Error(`misc-runner failed with exit code ${miscResult.exitCode}`);
  }

  console.log(`Job ${jobId} completed successfully`);
}

/**
 * Handle a Pub/Sub message
 */
async function handleMessage(message: Message): Promise<void> {
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

/**
 * Graceful shutdown handler
 */
let isShuttingDown = false;

function handleShutdown(signal: string): void {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`Received ${signal}, shutting down gracefully...`);

  // Close the subscription
  subscription.close().then(() => {
    console.log('Subscription closed');
    process.exit(0);
  }).catch((error) => {
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

/**
 * Main entry point
 */
async function main(): Promise<void> {
  // Ensure jobs directory exists
  await fs.mkdir(JOBS_DIR, { recursive: true });

  console.log('Subscribing to Pub/Sub messages...');

  // Handle incoming messages
  subscription.on('message', handleMessage);

  subscription.on('error', (error) => {
    console.error('Subscription error:', error);
  });

  console.log('Worker is running. Waiting for messages...');
}

main().catch((error) => {
  console.error('Worker failed to start:', error);
  process.exit(1);
});
