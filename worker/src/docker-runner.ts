/**
 * Docker Runner — runs a single simulation via `docker run --rm`.
 *
 * Replaces Swarm orchestration with a simple blocking container execution.
 * Logs come directly from stdout — no `docker service logs` race condition.
 * The `--rm` flag auto-removes the container on exit.
 */

import * as os from 'os';
import { spawn } from 'child_process';

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
const RAM_PER_SIM_MB = 900;  // Increased from 600 to fix OOM kills
const SYSTEM_RESERVE_MB = 2048;
const CONTAINER_TIMEOUT_MS = 30 * 60 * 1000;  // 30 minutes
const MAX_CONCURRENT_SIMS = parseInt(process.env.MAX_CONCURRENT_SIMS || '6', 10);
const CPUS_PER_SIM = 2;  // Forge + Java JIT + xvfb needs ~2 CPUs per sim

// ============================================================================
// Container execution
// ============================================================================

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
    '--simulations', '1',
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
