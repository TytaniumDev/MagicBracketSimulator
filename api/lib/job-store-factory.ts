/**
 * Job store factory: delegates to Firestore when GOOGLE_CLOUD_PROJECT is set,
 * otherwise to SQLite (job-store).
 */
import { Job, JobStatus, DeckSlot, AnalysisResult, SimulationStatus } from './types';
import * as sqliteStore from './job-store';
import * as firestoreStore from './firestore-job-store';

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

export async function deleteSimulations(jobId: string): Promise<void> {
  if (USE_FIRESTORE) {
    await firestoreStore.deleteSimulations(jobId);
    return;
  }
  sqliteStore.deleteSimulations(jobId);
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

