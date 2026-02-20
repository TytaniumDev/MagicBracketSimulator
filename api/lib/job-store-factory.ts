/**
 * Job store factory: delegates to Firestore when GOOGLE_CLOUD_PROJECT is set,
 * otherwise to SQLite (job-store).
 */
import { Job, JobStatus, DeckSlot, SimulationStatus, SimulationState, WorkerInfo, GAMES_PER_CONTAINER } from './types';
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

export async function listActiveJobs(): Promise<Job[]> {
  if (USE_FIRESTORE) {
    return firestoreStore.listActiveJobs();
  }
  return sqliteStore.listActiveJobs();
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

export async function conditionalUpdateSimulationStatus(
  jobId: string,
  simId: string,
  expectedStates: SimulationState[],
  update: Partial<SimulationStatus>
): Promise<boolean> {
  if (USE_FIRESTORE) {
    return firestoreStore.conditionalUpdateSimulationStatus(jobId, simId, expectedStates, update);
  }
  return sqliteStore.conditionalUpdateSimulationStatus(jobId, simId, expectedStates, update);
}

/**
 * Detect and recover a stale RUNNING/QUEUED job.
 *
 * Uses per-simulation recovery: individually retries stuck or failed sims
 * rather than resetting the entire job. Sims are retried indefinitely until
 * they succeed (or the job is cancelled).
 *
 * Returns true if any recovery action was taken.
 */
export async function recoverStaleJob(jobId: string): Promise<boolean> {
  const job = await getJob(jobId);
  if (!job) return false;

  // Handle stuck QUEUED jobs: re-publish if stuck for >2 minutes
  if (job.status === 'QUEUED') {
    return recoverStaleQueuedJob(jobId, job);
  }

  if (job.status !== 'RUNNING') return false;

  // Always use per-simulation recovery, regardless of primary worker health.
  // Multiple workers can process sims for the same job via Pub/Sub.
  const activeWorkers = await workerStore.getActiveWorkers(120_000);
  return recoverStaleSimulations(jobId, job, activeWorkers);
}

// ─── Per-Simulation Stale Detection ──────────────────────────────────────────

const STALE_PENDING_THRESHOLD_MS = 5 * 60 * 1000;       // 5 minutes
const STALE_RUNNING_THRESHOLD_MS = 2.5 * 60 * 60 * 1000; // 2.5 hours (container timeout + buffer)

/**
 * Detect and recover individual stuck simulations within a RUNNING job.
 *
 * Handles four cases:
 * 1. PENDING sims stuck >5 min: Pub/Sub message was lost → republish
 * 2. RUNNING sims stuck >2.5 hrs: container hung → mark FAILED (will be retried next scan)
 * 3. RUNNING sims whose worker is dead: worker crashed → mark FAILED (will be retried next scan)
 * 4. FAILED sims: reset to PENDING + republish for automatic retry
 *
 * Uses conditional writes (Firestore transactions) to prevent race conditions
 * where a worker completes a sim between the read and the recovery write.
 */
async function recoverStaleSimulations(
  jobId: string,
  job: Job,
  activeWorkers: WorkerInfo[],
): Promise<boolean> {
  if (!USE_FIRESTORE) return false; // Only applies in GCP mode with Pub/Sub

  const sims = await getSimulationStatuses(jobId);
  if (sims.length === 0) return false;

  const now = Date.now();
  const activeWorkerIds = new Set(activeWorkers.map((w) => w.workerId));
  let recovered = false;

  const simsToRepublish: SimulationStatus[] = [];

  for (const sim of sims) {
    // Case 1: PENDING sim stuck for >5 minutes — republish its Pub/Sub message
    if (sim.state === 'PENDING') {
      const jobStartedMs = job.startedAt ? job.startedAt.getTime() : job.createdAt.getTime();
      const pendingForMs = now - jobStartedMs;
      if (pendingForMs > STALE_PENDING_THRESHOLD_MS) {
        console.log(`[Recovery] Job ${jobId} sim ${sim.simId} stuck PENDING for ${Math.round(pendingForMs / 1000)}s, republishing`);
        simsToRepublish.push(sim);
        recovered = true;
      }
    }

    // Case 2: RUNNING sim stuck for >2.5 hours — container timed out
    if (sim.state === 'RUNNING' && sim.startedAt) {
      const runningForMs = now - new Date(sim.startedAt).getTime();
      if (runningForMs > STALE_RUNNING_THRESHOLD_MS) {
        console.log(`[Recovery] Job ${jobId} sim ${sim.simId} stuck RUNNING for ${Math.round(runningForMs / 60000)}min, marking FAILED for retry`);
        const updated = await conditionalUpdateSimulationStatus(jobId, sim.simId, ['RUNNING'], {
          state: 'FAILED',
          errorMessage: `Simulation timed out after ${Math.round(runningForMs / 60000)} minutes`,
          completedAt: new Date().toISOString(),
        });
        if (updated) {
          simsToRepublish.push(sim);
          recovered = true;
        }
      }
    }

    // Case 3: RUNNING sim whose specific worker is dead
    if (sim.state === 'RUNNING' && sim.workerId && !activeWorkerIds.has(sim.workerId)) {
      console.log(`[Recovery] Job ${jobId} sim ${sim.simId} worker ${sim.workerId} is dead, marking FAILED for retry`);
      const updated = await conditionalUpdateSimulationStatus(jobId, sim.simId, ['RUNNING'], {
        state: 'FAILED',
        errorMessage: 'Worker lost connection',
        completedAt: new Date().toISOString(),
      });
      if (updated) {
        simsToRepublish.push(sim);
        recovered = true;
      }
    }

    // Case 4: FAILED sim — retry by resetting to PENDING + republish
    if (sim.state === 'FAILED' && activeWorkers.length > 0) {
      console.log(`[Recovery] Job ${jobId} sim ${sim.simId} is FAILED, retrying`);
      simsToRepublish.push(sim);
      recovered = true;
    }
  }

  // Republish messages for recovered sims so they can be retried
  if (simsToRepublish.length > 0) {
    try {
      const { pubsub: pubsubClient, TOPIC_NAME } = await import('./pubsub');
      const topic = pubsubClient.topic(TOPIC_NAME);
      const promises = simsToRepublish.map((sim) => {
        const msg = {
          type: 'simulation' as const,
          jobId,
          simId: sim.simId,
          simIndex: sim.index,
          totalSims: job.simulations,
        };
        // Reset to PENDING so workers can pick them up (conditional to prevent races)
        return conditionalUpdateSimulationStatus(jobId, sim.simId, ['FAILED', 'PENDING'], { state: 'PENDING' })
          .then((updated) => {
            if (updated) return topic.publishMessage({ json: msg });
          });
      });
      await Promise.all(promises);
      console.log(`[Recovery] Republished ${simsToRepublish.length} simulation messages for job ${jobId}`);
    } catch (err) {
      console.warn(`[Recovery] Failed to republish sims for job ${jobId}:`, err);
    }
  }

  // Only aggregate when all sims are COMPLETED or CANCELLED (not FAILED — those will be retried)
  if (!recovered) {
    const allDone = sims.every(
      (s) => s.state === 'COMPLETED' || s.state === 'CANCELLED'
    );
    if (allDone) {
      aggregateJobResults(jobId).catch((err) => {
        console.error(`[Recovery] Aggregation failed for job ${jobId}:`, err);
      });
    }
  }

  return recovered;
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
      const containerCount = Math.ceil(job.simulations / GAMES_PER_CONTAINER);
      await initializeSimulations(jobId, containerCount);
      const { publishSimulationTasks } = await import('./pubsub');
      await publishSimulationTasks(jobId, containerCount);
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
 * Aggregate results when all simulations are COMPLETED or CANCELLED.
 * FAILED sims are NOT considered terminal — they will be retried by the scanner.
 * Reads incrementally uploaded raw logs, runs ingestion (condense + structure),
 * and sets the job to COMPLETED or CANCELLED.
 */
export async function aggregateJobResults(jobId: string): Promise<void> {
  const sims = await getSimulationStatuses(jobId);
  if (sims.length === 0) return;

  // Only aggregate when all sims are COMPLETED or CANCELLED.
  // FAILED sims will be retried by the stale job scanner.
  const allDone = sims.every(s => s.state === 'COMPLETED' || s.state === 'CANCELLED');
  if (!allDone) return;

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

  // Don't overwrite CANCELLED status — logs are ingested above, but status stays CANCELLED
  if (job.status === 'CANCELLED') return;

  const allCancelled = sims.every(s => s.state === 'CANCELLED');
  if (allCancelled) return; // Already handled by cancel flow

  await setJobCompleted(jobId);
}

