/**
 * Job store factory: delegates to Firestore when GOOGLE_CLOUD_PROJECT is set,
 * otherwise to SQLite (job-store).
 */
import { Job, JobStatus, DeckSlot, AnalysisResult, SimulationStatus } from './types';
import * as sqliteStore from './job-store';
import * as firestoreStore from './firestore-job-store';
import * as workerStore from './worker-store-factory';

const USE_FIRESTORE = typeof process.env.GOOGLE_CLOUD_PROJECT === 'string' && process.env.GOOGLE_CLOUD_PROJECT.length > 0;

// Log mode detection at startup
console.log(`[Job Store] Running in ${USE_FIRESTORE ? 'GCP' : 'LOCAL'} mode`);
if (USE_FIRESTORE) {
  console.log(`[Job Store] Project: ${process.env.GOOGLE_CLOUD_PROJECT}`);
  console.log(`[Job Store] Using: Firestore + Cloud Storage + Pub/Sub`);
} else {
  console.log(`[Job Store] Using: SQLite + local filesystem`);
}

export function isGcpMode(): boolean {
  return USE_FIRESTORE;
}

export async function getJob(id: string): Promise<Job | null> {
  if (USE_FIRESTORE) {
    return firestoreStore.getJob(id);
  }
  const job = sqliteStore.getJob(id);
  return job ?? null;
}

export async function getJobByIdempotencyKey(key: string): Promise<Job | null> {
  if (USE_FIRESTORE) {
    return firestoreStore.getJobByIdempotencyKey(key);
  }
  const job = sqliteStore.getJobByIdempotencyKey(key);
  return job ?? null;
}

export async function createJob(
  decks: DeckSlot[],
  simulations: number,
  options?: { idempotencyKey?: string; parallelism?: number; createdBy?: string; deckIds?: string[] }
): Promise<Job> {
  if (USE_FIRESTORE) {
    return firestoreStore.createJob({
      decks,
      simulations,
      parallelism: options?.parallelism,
      idempotencyKey: options?.idempotencyKey,
      createdBy: options?.createdBy ?? 'unknown',
      deckIds: options?.deckIds,
    });
  }
  return sqliteStore.createJob(
    decks,
    simulations,
    options?.idempotencyKey,
    options?.parallelism,
    options?.deckIds
  );
}

export async function listJobs(userId?: string): Promise<Job[]> {
  if (USE_FIRESTORE) {
    return firestoreStore.listJobs(userId);
  }
  return sqliteStore.listJobs();
}

export async function updateJobStatus(id: string, status: JobStatus): Promise<void> {
  if (USE_FIRESTORE) {
    await firestoreStore.updateJobStatus(id, status);
    return;
  }
  sqliteStore.updateJobStatus(id, status);
}

export async function setJobStartedAt(id: string, workerId?: string, workerName?: string): Promise<void> {
  if (USE_FIRESTORE) {
    await firestoreStore.setJobStartedAt(id, workerId, workerName);
    return;
  }
  sqliteStore.setJobStartedAt(id, workerId, workerName);
}

export async function updateJobProgress(id: string, gamesCompleted: number): Promise<void> {
  if (USE_FIRESTORE) {
    await firestoreStore.updateJobProgress(id, gamesCompleted);
    return;
  }
  sqliteStore.updateJobProgress(id, gamesCompleted);
}

export async function incrementGamesCompleted(id: string): Promise<void> {
  if (USE_FIRESTORE) {
    await firestoreStore.incrementGamesCompleted(id);
    return;
  }
  sqliteStore.incrementGamesCompleted(id);
}

export async function setJobCompleted(id: string, dockerRunDurationsMs?: number[]): Promise<void> {
  if (USE_FIRESTORE) {
    await firestoreStore.setJobCompleted(id, dockerRunDurationsMs);
    return;
  }
  sqliteStore.setJobCompleted(id, { dockerRunDurationsMs });
}

export async function setJobFailed(id: string, errorMessage: string, dockerRunDurationsMs?: number[]): Promise<void> {
  if (USE_FIRESTORE) {
    await firestoreStore.setJobFailed(id, errorMessage);
    return;
  }
  sqliteStore.setJobFailed(id, errorMessage, { dockerRunDurationsMs });
}

export async function setJobResult(id: string, result: AnalysisResult): Promise<void> {
  if (USE_FIRESTORE) {
    await firestoreStore.setJobResult(id, result);
    return;
  }
  sqliteStore.setJobResult(id, result);
}

export async function updateJobResult(id: string, result: AnalysisResult): Promise<void> {
  if (USE_FIRESTORE) {
    await firestoreStore.setJobResult(id, result);
    return;
  }
  sqliteStore.updateJobResult(id, result);
}

export async function claimNextJob(): Promise<Job | null> {
  if (USE_FIRESTORE) {
    return firestoreStore.claimNextJob();
  }
  const job = sqliteStore.claimNextJob();
  return job ?? null;
}

export async function cancelJob(id: string): Promise<boolean> {
  if (USE_FIRESTORE) {
    return firestoreStore.cancelJob(id);
  }
  return sqliteStore.cancelJob(id);
}

export async function deleteJob(id: string): Promise<void> {
  if (USE_FIRESTORE) {
    await firestoreStore.deleteJob(id);
    return;
  }
  sqliteStore.deleteJob(id);
}

// ─── Per-Simulation Tracking ─────────────────────────────────────────────────

export async function initializeSimulations(jobId: string, count: number): Promise<void> {
  if (USE_FIRESTORE) {
    await firestoreStore.initializeSimulations(jobId, count);
    return;
  }
  sqliteStore.initializeSimulations(jobId, count);
}

export async function updateSimulationStatus(
  jobId: string,
  simId: string,
  update: Partial<SimulationStatus>
): Promise<void> {
  if (USE_FIRESTORE) {
    await firestoreStore.updateSimulationStatus(jobId, simId, update);
    return;
  }
  sqliteStore.updateSimulationStatus(jobId, simId, update);
}

export async function getSimulationStatuses(jobId: string): Promise<SimulationStatus[]> {
  if (USE_FIRESTORE) {
    return firestoreStore.getSimulationStatuses(jobId);
  }
  return sqliteStore.getSimulationStatuses(jobId);
}

export async function resetJobForRetry(id: string): Promise<boolean> {
  if (USE_FIRESTORE) {
    return firestoreStore.resetJobForRetry(id);
  }
  return sqliteStore.resetJobForRetry(id);
}

export async function deleteSimulations(jobId: string): Promise<void> {
  if (USE_FIRESTORE) {
    await firestoreStore.deleteSimulations(jobId);
    return;
  }
  sqliteStore.deleteSimulations(jobId);
}

// ─── Stale Job Recovery ──────────────────────────────────────────────────────

/**
 * Detect and recover a stale RUNNING job whose worker has died.
 *
 * If the job's worker is no longer sending heartbeats (2 min threshold):
 *   - retryCount === 0 → reset job to QUEUED for automatic retry
 *   - retryCount >= 1  → fail the job permanently
 *
 * Returns true if the job was recovered (retried or failed).
 */
export async function recoverStaleJob(jobId: string): Promise<boolean> {
  const job = await getJob(jobId);
  if (!job) return false;

  // Handle stuck QUEUED jobs: re-publish if stuck for >2 minutes
  if (job.status === 'QUEUED') {
    return recoverStaleQueuedJob(jobId, job);
  }

  if (job.status !== 'RUNNING' || !job.workerId) return false;

  // Check if the worker is still alive (2 min heartbeat threshold)
  const activeWorkers = await workerStore.getActiveWorkers(120_000);
  const workerAlive = activeWorkers.some((w) => w.workerId === job.workerId);
  if (workerAlive) return false;

  const retryCount = job.retryCount ?? 0;

  if (retryCount === 0) {
    // First failure — retry the job
    console.log(`[Recovery] Job ${jobId} worker ${job.workerId} is stale, retrying (attempt 1)`);
    await deleteSimulations(jobId);
    await resetJobForRetry(jobId);

    // Re-initialize simulations and re-publish per-sim Pub/Sub messages
    if (USE_FIRESTORE) {
      try {
        await initializeSimulations(jobId, job.simulations);
        const { publishSimulationTasks } = await import('./pubsub');
        await publishSimulationTasks(jobId, job.simulations);
      } catch (err) {
        console.warn(`[Recovery] Failed to publish retry for job ${jobId}:`, err);
      }
    }
    return true;
  }

  // Already retried — fail permanently
  console.log(`[Recovery] Job ${jobId} worker stale after retry, failing permanently`);

  // Mark remaining PENDING/RUNNING sims as FAILED
  const sims = await getSimulationStatuses(jobId);
  for (const sim of sims) {
    if (sim.state === 'PENDING' || sim.state === 'RUNNING') {
      await updateSimulationStatus(jobId, sim.simId, {
        state: 'FAILED',
        errorMessage: 'Worker lost connection',
        completedAt: new Date().toISOString(),
      });
    }
  }

  await setJobFailed(jobId, 'Worker lost connection (retry exhausted)');
  return true;
}

/**
 * Re-publish a QUEUED job that may have lost its Pub/Sub message.
 *
 * If the job has been QUEUED for >2 minutes, re-publish to Pub/Sub so
 * any online worker can pick it up. Uses a per-job cooldown to avoid
 * spamming Pub/Sub with duplicate messages.
 */
const requeueCooldowns = new Map<string, number>();

async function recoverStaleQueuedJob(jobId: string, job: Job): Promise<boolean> {
  if (!USE_FIRESTORE) return false; // Polling mode picks up QUEUED jobs automatically

  const queuedForMs = Date.now() - job.createdAt.getTime();
  if (queuedForMs < 120_000) return false; // Not stuck yet

  // Cooldown: don't re-publish more often than every 2 minutes per job
  const lastRequeue = requeueCooldowns.get(jobId) ?? 0;
  if (Date.now() - lastRequeue < 120_000) return false;

  // Only re-publish if there's at least one active worker to receive it
  const activeWorkers = await workerStore.getActiveWorkers();
  if (activeWorkers.length === 0) return false;

  console.log(`[Recovery] Job ${jobId} stuck in QUEUED for ${Math.round(queuedForMs / 1000)}s, re-publishing to Pub/Sub`);
  requeueCooldowns.set(jobId, Date.now());

  try {
    // Re-publish per-simulation messages for any PENDING simulations
    const sims = await getSimulationStatuses(jobId);
    if (sims.length === 0) {
      // Sims not yet initialized — initialize and publish all
      await initializeSimulations(jobId, job.simulations);
      const { publishSimulationTasks } = await import('./pubsub');
      await publishSimulationTasks(jobId, job.simulations);
    } else {
      // Re-publish only for PENDING sims
      const pendingSims = sims.filter(s => s.state === 'PENDING');
      if (pendingSims.length > 0) {
        const { publishSimulationTasks: publish } = await import('./pubsub');
        const topic = (await import('./pubsub')).pubsub.topic((await import('./pubsub')).TOPIC_NAME);
        const promises = pendingSims.map(s => {
          const msg = {
            type: 'simulation' as const,
            jobId,
            simId: s.simId,
            simIndex: s.index,
            totalSims: job.simulations,
          };
          return topic.publishMessage({ json: msg });
        });
        await Promise.all(promises);
        console.log(`[Recovery] Re-published ${pendingSims.length} pending simulation messages for job ${jobId}`);
      }
    }
    return true;
  } catch (err) {
    console.warn(`[Recovery] Failed to re-publish queued job ${jobId}:`, err);
    return false;
  }
}

/**
 * Derive the overall job status from the aggregate simulation states.
 * Returns null if there are no simulations (legacy job without per-sim tracking).
 */
export function deriveJobStatus(simulations: SimulationStatus[]): JobStatus | null {
  if (simulations.length === 0) return null;

  const states = simulations.map((s) => s.state);
  const terminal = (s: string) => s === 'COMPLETED' || s === 'FAILED' || s === 'CANCELLED';
  const allPending = states.every((s) => s === 'PENDING');
  const anyRunning = states.some((s) => s === 'RUNNING');
  const allDone = states.every(terminal);
  const allFailed = states.every((s) => s === 'FAILED');
  const allCancelled = states.every((s) => s === 'CANCELLED');
  const anyCancelled = states.some((s) => s === 'CANCELLED');

  if (allPending) return 'QUEUED';
  if (allCancelled) return 'CANCELLED';
  if (anyRunning || (!allDone && !allPending)) return 'RUNNING';
  if (allDone) {
    if (allFailed) return 'FAILED';
    if (anyCancelled && !states.some((s) => s === 'COMPLETED')) return 'CANCELLED';
    return 'COMPLETED';
  }

  return 'RUNNING';
}

/**
 * Aggregate results when all simulations have reached a terminal state.
 * Reads incrementally uploaded raw logs, runs ingestion (condense + structure),
 * and sets the job to COMPLETED or FAILED.
 */
export async function aggregateJobResults(jobId: string): Promise<void> {
  const sims = await getSimulationStatuses(jobId);
  const status = deriveJobStatus(sims);
  if (!status || status === 'RUNNING' || status === 'QUEUED') return;

  const job = await getJob(jobId);
  if (!job || job.status === 'COMPLETED' || job.status === 'FAILED') return; // Already aggregated

  // Read raw logs uploaded incrementally by workers
  const { getRawLogs, ingestLogs } = await import('./log-store');
  const rawLogs = await getRawLogs(jobId);

  if (rawLogs && rawLogs.length > 0) {
    const deckNames = job.decks.map(d => d.name);
    const deckLists = job.decks.map(d => d.dck ?? '');
    await ingestLogs(jobId, rawLogs, deckNames, deckLists);
  }

  if (status === 'COMPLETED') {
    await setJobCompleted(jobId);
  } else {
    const failedCount = sims.filter(s => s.state === 'FAILED').length;
    await setJobFailed(jobId, `${failedCount}/${sims.length} simulations failed`);
  }
}

