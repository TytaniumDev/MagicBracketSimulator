/**
 * Docker Runner — runs a single simulation via `docker run --rm`.
 *
 * Runs a single simulation as a blocking container execution.
 * Logs come directly from stdout. The `--rm` flag auto-removes the container on exit.
 */

import * as os from 'os';
import { execFile } from 'child_process';
import { spawn } from 'child_process';
import { GAMES_PER_CONTAINER } from './constants.js';

// ============================================================================
// Types
// ============================================================================

export interface SimulationResult {
  simId: string;
  index: number;
  exitCode: number;
  durationMs: number;
  logText: string;
  error?: string;
}

// ============================================================================
// Constants
// ============================================================================

const SIMULATION_IMAGE = process.env.SIMULATION_IMAGE || 'ghcr.io/tytaniumdev/magicbracketsimulator/simulation:latest';
const RAM_PER_SIM_MB = parseInt(process.env.RAM_PER_SIM_MB || '1200', 10);
const SYSTEM_RESERVE_MB = parseInt(process.env.SYSTEM_RESERVE_MB || '2048', 10);
const CONTAINER_TIMEOUT_MS = parseInt(process.env.CONTAINER_TIMEOUT_MS || String(2 * 60 * 60 * 1000), 10);  // Default: 2 hours
const MAX_CONCURRENT_SIMS = parseInt(process.env.MAX_CONCURRENT_SIMS || '6', 10);
const CPUS_PER_SIM = parseInt(process.env.CPUS_PER_SIM || '2', 10);

// ============================================================================
// Docker helpers
// ============================================================================

/**
 * Run a docker command and return its stdout as a string.
 */
function execDockerCommand(args: string[], timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('docker', args, { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`docker ${args[0]} failed: ${stderr?.trim() || err.message}`));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

/**
 * Kill and remove any orphaned `sim-*` containers from a previous worker instance.
 * Non-fatal: logs warnings on failure.
 */
export async function cleanupOrphanedContainers(): Promise<void> {
  try {
    const output = await execDockerCommand([
      'ps', '-a', '--filter', 'name=sim-', '--format', '{{.Names}}',
    ]);
    if (!output) {
      console.log('Startup cleanup: no orphaned sim containers found');
      return;
    }
    const names = output.split('\n').filter(Boolean);
    console.log(`Startup cleanup: removing ${names.length} orphaned sim container(s)...`);
    for (const name of names) {
      try {
        await execDockerCommand(['rm', '-f', name]);
        console.log(`  Removed: ${name}`);
      } catch (err) {
        console.warn(`  Warning: failed to remove ${name}:`, err instanceof Error ? err.message : err);
      }
    }
  } catch (err) {
    console.warn('Startup cleanup: failed to list orphaned containers:', err instanceof Error ? err.message : err);
  }
}

/**
 * Prune stopped containers and dangling images to free disk space.
 * Non-fatal: logs warnings on failure.
 */
export async function pruneDockerResources(): Promise<void> {
  try {
    const containerOutput = await execDockerCommand(['container', 'prune', '-f']);
    console.log('Docker container prune:', containerOutput || '(nothing to prune)');
  } catch (err) {
    console.warn('Docker container prune failed:', err instanceof Error ? err.message : err);
  }
  try {
    const imageOutput = await execDockerCommand(['image', 'prune', '-f']);
    console.log('Docker image prune:', imageOutput || '(nothing to prune)');
  } catch (err) {
    console.warn('Docker image prune failed:', err instanceof Error ? err.message : err);
  }
}

// ============================================================================
// Container execution
// ============================================================================

/**
 * Check if a container with the given name already exists.
 * Returns 'running', 'stopped', or 'none'.
 */
async function getContainerState(containerName: string): Promise<'running' | 'stopped' | 'none'> {
  try {
    const status = await execDockerCommand([
      'inspect', '--format', '{{.State.Running}}', containerName,
    ]);
    return status === 'true' ? 'running' : 'stopped';
  } catch {
    return 'none';
  }
}

/**
 * Run a single simulation as a `docker run --rm` container.
 * Blocks until the container exits. Stdout contains the game logs.
 */
export async function runSimulationContainer(
  jobId: string,
  simId: string,
  index: number,
  deckContents: [string, string, string, string],
  signal?: AbortSignal,
): Promise<SimulationResult> {
  const startTime = Date.now();
  const containerName = `sim-${jobId.slice(0, 8)}-${simId}`;

  // Guard against duplicate containers (e.g. from Pub/Sub redelivery)
  const existing = await getContainerState(containerName);
  if (existing === 'running') {
    console.log(`[${simId}] Container ${containerName} is already running, skipping duplicate`);
    return { simId, index, exitCode: 0, durationMs: 0, logText: '', error: 'AlreadyRunning' };
  }
  if (existing === 'stopped') {
    console.log(`[${simId}] Removing stopped container ${containerName}`);
    try { await execDockerCommand(['rm', '-f', containerName]); } catch { /* ignore */ }
  }

  const deckFilenames: [string, string, string, string] = ['deck_0.dck', 'deck_1.dck', 'deck_2.dck', 'deck_3.dck'];

  // Base64-encode deck contents into env vars
  const deckEnvVars: string[] = [];
  for (let i = 0; i < 4; i++) {
    const b64 = Buffer.from(deckContents[i], 'utf-8').toString('base64');
    deckEnvVars.push('-e', `DECK_${i}_B64=${b64}`);
  }

  const args = [
    'run', '--rm',
    '--name', containerName,
    '--memory', `${RAM_PER_SIM_MB}m`,
    '--cpus', String(CPUS_PER_SIM),
    ...deckEnvVars,
    '-e', 'FORGE_PATH=/app/forge',
    '-e', 'LOGS_DIR=/app/logs',
    SIMULATION_IMAGE,
    '--decks', ...deckFilenames,
    '--simulations', String(GAMES_PER_CONTAINER),
    '--id', `${jobId}_${simId}`,
  ];

  console.log(`[${simId}] Starting container ${containerName} (image=${SIMULATION_IMAGE}, memory=${RAM_PER_SIM_MB}m)`);

  return new Promise<SimulationResult>((resolve) => {
    const proc = spawn('docker', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    proc.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    proc.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    // Timeout: kill the container if it hangs
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      console.error(`[${simId}] Container timed out after ${CONTAINER_TIMEOUT_MS / 1000}s, killing...`);
      // Kill the docker run process
      proc.kill('SIGTERM');
      // Also force-remove the container in case SIGTERM doesn't propagate
      spawn('docker', ['rm', '-f', containerName], { stdio: 'ignore' });
    }, CONTAINER_TIMEOUT_MS);

    // AbortSignal: kill the container if the job is cancelled
    let cancelled = false;
    const onAbort = () => {
      cancelled = true;
      console.log(`[${simId}] Cancellation signal received, killing container ${containerName}...`);
      proc.kill('SIGTERM');
      spawn('docker', ['rm', '-f', containerName], { stdio: 'ignore' });
    };
    if (signal) {
      if (signal.aborted) {
        // Already aborted before we started
        onAbort();
      } else {
        signal.addEventListener('abort', onAbort, { once: true });
      }
    }

    proc.on('error', (err) => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      const durationMs = Date.now() - startTime;
      resolve({
        simId, index, exitCode: 1, durationMs,
        logText: '', error: `Failed to start container: ${err.message}`,
      });
    });

    proc.on('close', (code) => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      const durationMs = Date.now() - startTime;
      const logText = Buffer.concat(stdoutChunks).toString('utf-8');
      const stderr = Buffer.concat(stderrChunks).toString('utf-8');

      let exitCode = code ?? 1;
      let error: string | undefined;

      if (cancelled) {
        exitCode = 137;
        error = 'Cancelled';
      } else if (timedOut) {
        exitCode = 124;
        error = `Container timed out after ${CONTAINER_TIMEOUT_MS / 1000}s`;
      } else if (exitCode !== 0) {
        error = stderr.trim().slice(0, 500) || `Exit code ${exitCode}`;
      }

      resolve({ simId, index, exitCode, durationMs, logText, error });
    });
  });
}

// ============================================================================
// Capacity calculation
// ============================================================================

/**
 * Calculate how many simulations this machine can run concurrently.
 * Based on available RAM and CPUs, with reserves for the OS and worker.
 */
export function calculateLocalCapacity(): number {
  const totalMemMB = Math.floor(os.totalmem() / (1024 * 1024));
  const cpuCount = os.cpus().length;

  const availableMem = Math.max(0, totalMemMB - SYSTEM_RESERVE_MB);
  const memSlots = Math.floor(availableMem / RAM_PER_SIM_MB);
  const cpuSlots = Math.max(1, Math.floor((cpuCount - 2) / CPUS_PER_SIM));

  const capacity = Math.max(1, Math.min(memSlots, cpuSlots, MAX_CONCURRENT_SIMS));

  console.log(
    `Local capacity: ${totalMemMB}MB RAM, ${cpuCount} CPUs → ` +
    `memSlots=${memSlots}, cpuSlots=${cpuSlots}, cap=${MAX_CONCURRENT_SIMS}, using=${capacity}`,
  );

  return capacity;
}
