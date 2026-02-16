/**
 * Swarm Orchestrator — manages simulation lifecycle via Docker Swarm services.
 *
 * Each simulation runs as a one-shot swarm service (`--restart-condition=none`).
 * Deck content is delivered via base64-encoded environment variables so no
 * shared filesystem is needed across nodes.  Logs are collected from
 * `docker service logs` after the service completes.
 */

import { runProcess } from './process.js';

// ============================================================================
// Constants
// ============================================================================

const SIMULATION_IMAGE = process.env.SIMULATION_IMAGE || 'ghcr.io/tytaniumdev/magicbracketsimulator/simulation:latest';

// Resource limits per simulation container
const RAM_PER_SIM_MB = 600;
const SYSTEM_RESERVE_MB = 2048; // per node

// Polling interval when waiting for a service to finish
const SERVICE_POLL_MS = 3000;

// Maximum time to wait for a single simulation (2 hours)
const SERVICE_TIMEOUT_MS = 2 * 60 * 60 * 1000;

// ============================================================================
// Types
// ============================================================================

export interface SwarmSimulationResult {
  simId: string;
  index: number;
  exitCode: number;
  durationMs: number;
  logText: string;
  error?: string;
}

// ============================================================================
// Swarm health check
// ============================================================================

/**
 * Verify the Docker daemon is in swarm mode.
 * Throws if not active — call at startup before accepting jobs.
 */
export async function verifySwarmActive(): Promise<void> {
  const { stdout } = await runProcessCapture('docker', [
    'info', '--format', '{{.Swarm.LocalNodeState}}',
  ]);
  const state = stdout.trim();
  if (state !== 'active') {
    throw new Error(
      `Docker Swarm is not active (state: "${state}"). ` +
      'Run "docker swarm init" or join an existing swarm first.',
    );
  }
  console.log('Docker Swarm: active');
}

// ============================================================================
// Capacity calculation
// ============================================================================

interface NodeResources {
  cpus: number;
  memoryMB: number;
}

/**
 * Query swarm nodes and compute how many simulations can run concurrently
 * across the entire cluster.
 */
export async function calculateSwarmCapacity(requested: number): Promise<number> {
  // Get node IDs of ready nodes
  const { stdout: nodeListOut } = await runProcessCapture('docker', [
    'node', 'ls', '--filter', 'role=worker', '--format', '{{.ID}} {{.Status}}',
  ]);
  // Also include manager nodes (managers can run tasks too)
  const { stdout: managerListOut } = await runProcessCapture('docker', [
    'node', 'ls', '--filter', 'role=manager', '--format', '{{.ID}} {{.Status}}',
  ]);

  const allLines = `${nodeListOut}\n${managerListOut}`
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0 && l.includes('Ready'));

  const nodeIds = allLines.map(l => l.split(/\s+/)[0]);

  if (nodeIds.length === 0) {
    console.log('Swarm capacity: no ready nodes found, using 1');
    return 1;
  }

  // Inspect each node for resources
  const nodes: NodeResources[] = [];
  for (const id of nodeIds) {
    const { stdout: inspectOut } = await runProcessCapture('docker', [
      'node', 'inspect', id, '--format',
      '{{.Description.Resources.NanoCPUs}} {{.Description.Resources.MemoryBytes}}',
    ]);
    const parts = inspectOut.trim().split(/\s+/);
    if (parts.length >= 2) {
      const cpus = Math.floor(Number(parts[0]) / 1e9);
      const memoryMB = Math.floor(Number(parts[1]) / (1024 * 1024));
      nodes.push({ cpus, memoryMB });
    }
  }

  // Sum capacity across all nodes, reserving resources per node
  let totalSlots = 0;
  for (const node of nodes) {
    const availableMem = Math.max(0, node.memoryMB - SYSTEM_RESERVE_MB);
    const memSlots = Math.floor(availableMem / RAM_PER_SIM_MB);
    const cpuSlots = Math.max(1, node.cpus - 2); // reserve 2 CPUs per node
    totalSlots += Math.min(memSlots, cpuSlots);
  }

  const capacity = Math.max(1, Math.min(requested, totalSlots));

  console.log(
    `Swarm capacity: ${nodes.length} nodes, ` +
    `totalSlots=${totalSlots}, requested=${requested}, using=${capacity}`,
  );

  return capacity;
}

// ============================================================================
// Service lifecycle
// ============================================================================

/**
 * Run a single simulation as a one-shot Docker Swarm service.
 *
 * Creates the service, polls until completion, reads logs via
 * `docker service logs`, removes the service, and returns the result.
 */
export async function runSimulationSwarmService(
  jobId: string,
  simId: string,
  index: number,
  deckContents: [string, string, string, string],
  deckFilenames: [string, string, string, string],
  checkCancelled?: () => Promise<boolean>,
): Promise<SwarmSimulationResult> {
  const serviceName = `sim-${jobId.slice(0, 8)}-${simId}`;
  const startTime = Date.now();

  // Base64-encode deck contents
  const deckEnvVars: string[] = [];
  for (let i = 0; i < 4; i++) {
    const b64 = Buffer.from(deckContents[i], 'utf-8').toString('base64');
    deckEnvVars.push('-e', `DECK_${i}_B64=${b64}`);
  }

  const args = [
    'service', 'create',
    '--name', serviceName,
    '--restart-condition', 'none',
    '--detach',
    '--with-registry-auth',
    '--limit-memory', `${RAM_PER_SIM_MB}m`,
    '--limit-cpu', '1',
    ...deckEnvVars,
    '-e', 'FORGE_PATH=/app/forge',
    '-e', 'LOGS_DIR=/app/logs',
    SIMULATION_IMAGE,
    '--decks', ...deckFilenames,
    '--simulations', '1',
    '--id', `${jobId}_${simId}`,
  ];

  // Create the service
  try {
    await runProcess('docker', args, { timeout: 30_000 });
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { simId, index, exitCode: 1, durationMs, logText: '', error: `Service create failed: ${errorMsg}` };
  }

  // Poll until the service's task reaches a terminal state
  let exitCode = 1;
  let error: string | undefined;

  let cancelled = false;
  const deadline = Date.now() + SERVICE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(SERVICE_POLL_MS);

    // Check for cancellation
    if (checkCancelled) {
      try {
        if (await checkCancelled()) {
          cancelled = true;
          error = 'Job cancelled';
          break;
        }
      } catch {
        // Ignore cancellation check errors
      }
    }

    const { stdout: taskOut } = await runProcessCapture('docker', [
      'service', 'ps', serviceName,
      '--format', '{{.DesiredState}} {{.CurrentState}} {{.Error}}',
      '--no-trunc',
    ]);

    const line = taskOut.trim().split('\n')[0] || '';
    const lowerLine = line.toLowerCase();

    if (lowerLine.includes('complete')) {
      exitCode = 0;
      break;
    }
    if (lowerLine.includes('failed') || lowerLine.includes('rejected') || lowerLine.includes('shutdown')) {
      exitCode = 1;
      error = `Task ended: ${line}`;
      break;
    }
    // Otherwise still running/pending — keep polling
  }

  if (Date.now() >= deadline && exitCode !== 0) {
    error = `Service timed out after ${SERVICE_TIMEOUT_MS / 1000}s`;
  }

  // If cancelled, kill the service and return early
  if (cancelled) {
    try {
      await runProcess('docker', ['service', 'rm', serviceName], { timeout: 15_000 });
    } catch {
      console.warn(`Warning: failed to remove cancelled service ${serviceName}`);
    }
    const durationMs = Date.now() - startTime;
    return { simId, index, exitCode: 1, durationMs, logText: '', error };
  }

  // Collect logs
  let logText = '';
  try {
    const { stdout: logs } = await runProcessCapture('docker', [
      'service', 'logs', '--raw', serviceName,
    ]);
    logText = logs;
  } catch {
    // Logs may be unavailable if the task never started
  }

  // Remove the service
  try {
    await runProcess('docker', ['service', 'rm', serviceName], { timeout: 15_000 });
  } catch {
    console.warn(`Warning: failed to remove service ${serviceName}`);
  }

  const durationMs = Date.now() - startTime;
  return { simId, index, exitCode, durationMs, logText, error };
}

// ============================================================================
// Cleanup
// ============================================================================

/**
 * Remove any orphaned `sim-*` services (e.g. from a previous crash).
 */
export async function cleanupSwarmServices(): Promise<void> {
  try {
    const { stdout } = await runProcessCapture('docker', [
      'service', 'ls', '--filter', 'name=sim-', '--format', '{{.Name}}',
    ]);
    const services = stdout.trim().split('\n').filter(s => s.length > 0);
    if (services.length === 0) return;

    console.log(`Cleaning up ${services.length} orphaned sim service(s)...`);
    for (const svc of services) {
      try {
        await runProcess('docker', ['service', 'rm', svc], { timeout: 15_000 });
      } catch {
        console.warn(`Warning: failed to remove service ${svc}`);
      }
    }
  } catch {
    // Swarm may not be active
  }
}

// ============================================================================
// Helpers
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Run a command and capture its stdout (unlike runProcess which uses stdio: 'inherit').
 */
async function runProcessCapture(
  command: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const { spawn } = await import('child_process');

  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    proc.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    proc.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    proc.on('error', reject);
    proc.on('close', (code) => {
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: Buffer.concat(stderrChunks).toString('utf-8'),
        exitCode: code ?? 1,
      });
    });
  });
}
