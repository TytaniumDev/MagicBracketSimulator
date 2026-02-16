import { Firestore, Timestamp, FieldValue } from '@google-cloud/firestore';
import { Job, JobStatus, DeckSlot, AnalysisResult, SimulationStatus, SimulationState } from './types';

// Initialize Firestore client
const firestore = new Firestore({
  projectId: process.env.GOOGLE_CLOUD_PROJECT || 'magic-bracket-simulator',
});

// Collection references
const jobsCollection = firestore.collection('jobs');
const idempotencyKeysCollection = firestore.collection('idempotencyKeys');

// Convert Firestore document to Job type
function docToJob(doc: FirebaseFirestore.DocumentSnapshot): Job | null {
  if (!doc.exists) return null;
  
  const data = doc.data()!;
  const deckIds = Array.isArray(data.deckIds) && data.deckIds.length === 4 ? data.deckIds as string[] : undefined;
  return {
    id: doc.id,
    decks: data.decks || [],
    ...(deckIds != null && { deckIds }),
    status: data.status as JobStatus,
    simulations: data.simulations,
    parallelism: data.parallelism,
    createdAt: data.createdAt?.toDate() || new Date(),
    startedAt: data.startedAt?.toDate(),
    completedAt: data.completedAt?.toDate(),
    gamesCompleted: data.gamesCompleted,
    errorMessage: data.errorMessage,
    resultJson: data.resultJson,
    dockerRunDurationsMs: data.dockerRunDurationsMs,
    ...(data.workerId && { workerId: data.workerId }),
    ...(data.workerName && { workerName: data.workerName }),
    ...(data.claimedAt && { claimedAt: data.claimedAt.toDate() }),
    ...(data.retryCount != null && data.retryCount > 0 && { retryCount: data.retryCount }),
  };
}

export interface CreateJobData {
  decks: DeckSlot[];
  simulations: number;
  parallelism?: number;
  idempotencyKey?: string;
  createdBy: string;
  deckIds?: string[];
}

/**
 * Create a new job in Firestore
 */
export async function createJob(data: CreateJobData): Promise<Job> {
  // Check idempotency key if provided
  if (data.idempotencyKey) {
    const existingJob = await getJobByIdempotencyKey(data.idempotencyKey);
    if (existingJob) {
      return existingJob;
    }
  }

  const jobRef = jobsCollection.doc();
  const now = Timestamp.now();

  const jobData = {
    decks: data.decks,
    ...(data.deckIds != null && data.deckIds.length === 4 && { deckIds: data.deckIds }),
    status: 'QUEUED' as JobStatus,
    simulations: data.simulations,
    parallelism: data.parallelism || 4,
    createdAt: now,
    createdBy: data.createdBy,
    idempotencyKey: data.idempotencyKey || null,
  };

  // Use transaction if idempotency key is provided
  if (data.idempotencyKey) {
    await firestore.runTransaction(async (transaction) => {
      // Check again within transaction
      const idempotencyRef = idempotencyKeysCollection.doc(data.idempotencyKey!);
      const idempotencyDoc = await transaction.get(idempotencyRef);
      
      if (idempotencyDoc.exists) {
        throw new Error('Idempotency key already exists');
      }

      // Create the job and idempotency key atomically
      transaction.set(jobRef, jobData);
      transaction.set(idempotencyRef, {
        jobId: jobRef.id,
        createdAt: now,
      });
    });
  } else {
    await jobRef.set(jobData);
  }

  return {
    id: jobRef.id,
    decks: data.decks,
    ...(data.deckIds != null && data.deckIds.length === 4 && { deckIds: data.deckIds }),
    status: 'QUEUED',
    simulations: data.simulations,
    parallelism: data.parallelism || 4,
    createdAt: now.toDate(),
  };
}

/**
 * Get a job by ID
 */
export async function getJob(id: string): Promise<Job | null> {
  const doc = await jobsCollection.doc(id).get();
  return docToJob(doc);
}

/**
 * Get a job by idempotency key
 */
export async function getJobByIdempotencyKey(key: string): Promise<Job | null> {
  const idempotencyDoc = await idempotencyKeysCollection.doc(key).get();
  if (!idempotencyDoc.exists) return null;
  
  const { jobId } = idempotencyDoc.data()!;
  return getJob(jobId);
}

/**
 * Update job status
 */
export async function updateJobStatus(id: string, status: JobStatus): Promise<void> {
  await jobsCollection.doc(id).update({
    status,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

/**
 * Set job started timestamp
 */
export async function setJobStartedAt(id: string, workerId?: string, workerName?: string): Promise<void> {
  const updateData: Record<string, unknown> = {
    status: 'RUNNING' as JobStatus,
    startedAt: FieldValue.serverTimestamp(),
    claimedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (workerId) {
    updateData.workerId = workerId;
  }
  if (workerName) {
    updateData.workerName = workerName;
  }
  await jobsCollection.doc(id).update(updateData);
}

/**
 * Mark job as completed
 */
export async function setJobCompleted(id: string, dockerRunDurationsMs?: number[]): Promise<void> {
  const updateData: Record<string, unknown> = {
    status: 'COMPLETED' as JobStatus,
    completedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (dockerRunDurationsMs) {
    updateData.dockerRunDurationsMs = dockerRunDurationsMs;
  }

  await jobsCollection.doc(id).update(updateData);
}

/**
 * Mark job as failed
 */
export async function setJobFailed(id: string, errorMessage: string): Promise<void> {
  await jobsCollection.doc(id).update({
    status: 'FAILED' as JobStatus,
    errorMessage,
    completedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
}

/**
 * Update job progress (games completed)
 */
export async function updateJobProgress(id: string, gamesCompleted: number): Promise<void> {
  await jobsCollection.doc(id).update({
    gamesCompleted,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

/**
 * Set job result (analysis result)
 */
export async function setJobResult(id: string, result: AnalysisResult): Promise<void> {
  await jobsCollection.doc(id).update({
    resultJson: result,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

/**
 * Get the next queued job (for local worker fallback)
 * Uses composite index: status ASC, createdAt ASC
 */
export async function getNextQueuedJob(): Promise<Job | null> {
  const snapshot = await jobsCollection
    .where('status', '==', 'QUEUED')
    .orderBy('createdAt', 'asc')
    .limit(1)
    .get();

  if (snapshot.empty) return null;
  return docToJob(snapshot.docs[0]);
}

/**
 * List jobs, optionally filtered by user
 */
export async function listJobs(userId?: string): Promise<Job[]> {
  let query: FirebaseFirestore.Query = jobsCollection.orderBy('createdAt', 'desc');
  
  if (userId) {
    query = query.where('createdBy', '==', userId);
  }

  const snapshot = await query.limit(100).get();
  return snapshot.docs.map(doc => docToJob(doc)).filter((job): job is Job => job !== null);
}

/**
 * Cancel a job: set status to CANCELLED, mark PENDING simulations as CANCELLED.
 * Only works for QUEUED or RUNNING jobs.
 */
export async function cancelJob(id: string): Promise<boolean> {
  const jobRef = jobsCollection.doc(id);
  const jobDoc = await jobRef.get();
  if (!jobDoc.exists) return false;

  const data = jobDoc.data()!;
  if (data.status !== 'QUEUED' && data.status !== 'RUNNING') return false;

  // Update job status
  await jobRef.update({
    status: 'CANCELLED',
    completedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Update PENDING simulations to CANCELLED in batches
  const simCol = simulationsCollection(id);
  const pendingSims = await simCol.where('state', '==', 'PENDING').get();

  if (!pendingSims.empty) {
    const batchSize = 500;
    for (let i = 0; i < pendingSims.docs.length; i += batchSize) {
      const batch = firestore.batch();
      const slice = pendingSims.docs.slice(i, i + batchSize);
      for (const doc of slice) {
        batch.update(doc.ref, {
          state: 'CANCELLED',
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
    }
  }

  return true;
}

/**
 * Delete a job and its idempotency key
 */
export async function deleteJob(id: string): Promise<void> {
  const job = await getJob(id);
  if (!job) return;

  // Delete idempotency key if exists
  const idempotencyQuery = await idempotencyKeysCollection
    .where('jobId', '==', id)
    .limit(1)
    .get();

  const batch = firestore.batch();
  batch.delete(jobsCollection.doc(id));
  
  if (!idempotencyQuery.empty) {
    batch.delete(idempotencyQuery.docs[0].ref);
  }

  await batch.commit();
}

/**
 * Atomically transition job status (for worker)
 */
export async function claimJob(id: string, workerId?: string, workerName?: string): Promise<boolean> {
  try {
    await firestore.runTransaction(async (transaction) => {
      const jobRef = jobsCollection.doc(id);
      const jobDoc = await transaction.get(jobRef);

      if (!jobDoc.exists) {
        throw new Error('Job not found');
      }

      const data = jobDoc.data()!;
      if (data.status !== 'QUEUED') {
        throw new Error('Job is not queued');
      }

      const updateData: Record<string, unknown> = {
        status: 'RUNNING',
        startedAt: FieldValue.serverTimestamp(),
        claimedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (workerId) {
        updateData.workerId = workerId;
      }
      if (workerName) {
        updateData.workerName = workerName;
      }
      transaction.update(jobRef, updateData);
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Atomically claim the next QUEUED job by transitioning it to RUNNING.
 * Returns the claimed job, or null if no QUEUED jobs exist.
 */
export async function claimNextJob(workerId?: string, workerName?: string): Promise<Job | null> {
  // Find the oldest queued job
  const snapshot = await jobsCollection
    .where('status', '==', 'QUEUED')
    .orderBy('createdAt', 'asc')
    .limit(1)
    .get();

  if (snapshot.empty) return null;

  const doc = snapshot.docs[0];
  const claimed = await firestore.runTransaction(async (transaction) => {
    const jobRef = jobsCollection.doc(doc.id);
    const jobDoc = await transaction.get(jobRef);
    if (!jobDoc.exists) return null;
    const data = jobDoc.data()!;
    if (data.status !== 'QUEUED') return null; // Already claimed by another worker

    const updateData: Record<string, unknown> = {
      status: 'RUNNING',
      startedAt: FieldValue.serverTimestamp(),
      claimedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (workerId) {
      updateData.workerId = workerId;
    }
    if (workerName) {
      updateData.workerName = workerName;
    }
    transaction.update(jobRef, updateData);
    return doc.id;
  });

  if (!claimed) return null;
  return getJob(claimed);
}

// ─── Per-Simulation Tracking (Subcollection) ────────────────────────────────

/**
 * Get the simulations subcollection reference for a job.
 */
function simulationsCollection(jobId: string) {
  return jobsCollection.doc(jobId).collection('simulations');
}

/**
 * Initialize simulation status documents for a job.
 * Creates `count` documents with state PENDING using batched writes.
 */
export async function initializeSimulations(
  jobId: string,
  count: number
): Promise<void> {
  const simCol = simulationsCollection(jobId);

  // Firestore batches are limited to 500 operations
  const batchSize = 500;
  for (let batchStart = 0; batchStart < count; batchStart += batchSize) {
    const batch = firestore.batch();
    const end = Math.min(batchStart + batchSize, count);
    for (let i = batchStart; i < end; i++) {
      const simId = `sim_${String(i).padStart(3, '0')}`;
      batch.set(simCol.doc(simId), {
        simId,
        index: i,
        state: 'PENDING' as SimulationState,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
  }
}

/**
 * Update a single simulation's status.
 */
export async function updateSimulationStatus(
  jobId: string,
  simId: string,
  update: Partial<SimulationStatus>
): Promise<void> {
  const updateData: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (update.state !== undefined) updateData.state = update.state;
  if (update.workerId !== undefined) updateData.workerId = update.workerId;
  if (update.workerName !== undefined) updateData.workerName = update.workerName;
  if (update.startedAt !== undefined) updateData.startedAt = update.startedAt;
  if (update.completedAt !== undefined) updateData.completedAt = update.completedAt;
  if (update.durationMs !== undefined) updateData.durationMs = update.durationMs;
  if (update.errorMessage !== undefined) updateData.errorMessage = update.errorMessage;
  if (update.winner !== undefined) updateData.winner = update.winner;
  if (update.winningTurn !== undefined) updateData.winningTurn = update.winningTurn;

  await simulationsCollection(jobId).doc(simId).update(updateData);
}

/**
 * Get all simulation statuses for a job, ordered by index.
 */
export async function getSimulationStatuses(
  jobId: string
): Promise<SimulationStatus[]> {
  const snapshot = await simulationsCollection(jobId)
    .orderBy('index', 'asc')
    .get();

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      simId: doc.id,
      index: data.index ?? 0,
      state: (data.state ?? 'PENDING') as SimulationState,
      ...(data.workerId && { workerId: data.workerId }),
      ...(data.workerName && { workerName: data.workerName }),
      ...(data.startedAt && { startedAt: data.startedAt }),
      ...(data.completedAt && { completedAt: data.completedAt }),
      ...(data.durationMs != null && { durationMs: data.durationMs }),
      ...(data.errorMessage && { errorMessage: data.errorMessage }),
      ...(data.winner && { winner: data.winner }),
      ...(data.winningTurn != null && { winningTurn: data.winningTurn }),
    } as SimulationStatus;
  });
}

/**
 * Reset a job for retry: set status to QUEUED, clear runtime fields, increment retryCount.
 */
export async function resetJobForRetry(id: string): Promise<boolean> {
  const jobRef = jobsCollection.doc(id);
  const jobDoc = await jobRef.get();
  if (!jobDoc.exists) return false;

  const data = jobDoc.data()!;
  const currentRetryCount = data.retryCount ?? 0;

  await jobRef.update({
    status: 'QUEUED',
    startedAt: FieldValue.delete(),
    completedAt: FieldValue.delete(),
    errorMessage: FieldValue.delete(),
    gamesCompleted: FieldValue.delete(),
    workerId: FieldValue.delete(),
    workerName: FieldValue.delete(),
    claimedAt: FieldValue.delete(),
    dockerRunDurationsMs: FieldValue.delete(),
    retryCount: currentRetryCount + 1,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return true;
}

/**
 * Delete all simulation status documents for a job.
 */
export async function deleteSimulations(jobId: string): Promise<void> {
  const simCol = simulationsCollection(jobId);
  const snapshot = await simCol.get();
  if (snapshot.empty) return;

  const batchSize = 500;
  for (let i = 0; i < snapshot.docs.length; i += batchSize) {
    const batch = firestore.batch();
    const slice = snapshot.docs.slice(i, i + batchSize);
    for (const doc of slice) {
      batch.delete(doc.ref);
    }
    await batch.commit();
  }
}

export { firestore };

