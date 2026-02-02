/**
 * Job store factory: delegates to Firestore when GOOGLE_CLOUD_PROJECT is set,
 * otherwise to SQLite (job-store).
 */
import { Job, JobStatus, DeckSlot, AnalysisResult } from './types';
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
  options?: { idempotencyKey?: string; parallelism?: number; createdBy?: string }
): Promise<Job> {
  if (USE_FIRESTORE) {
    return firestoreStore.createJob({
      decks,
      simulations,
      parallelism: options?.parallelism,
      idempotencyKey: options?.idempotencyKey,
      createdBy: options?.createdBy ?? 'unknown',
    });
  }
  return sqliteStore.createJob(
    decks,
    simulations,
    options?.idempotencyKey,
    options?.parallelism
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

export async function setJobStartedAt(id: string): Promise<void> {
  if (USE_FIRESTORE) {
    await firestoreStore.setJobStartedAt(id);
    return;
  }
  sqliteStore.setJobStartedAt(id);
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

export async function deleteJob(id: string): Promise<void> {
  if (USE_FIRESTORE) {
    await firestoreStore.deleteJob(id);
    return;
  }
  sqliteStore.deleteJob(id);
}
