import { Firestore, Timestamp, FieldValue } from '@google-cloud/firestore';
import { Job, JobStatus, DeckSlot, AnalysisResult } from './types';

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
  return {
    id: doc.id,
    decks: data.decks || [],
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
  };
}

export interface CreateJobData {
  decks: DeckSlot[];
  simulations: number;
  parallelism?: number;
  idempotencyKey?: string;
  createdBy: string;
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
export async function setJobStartedAt(id: string): Promise<void> {
  await jobsCollection.doc(id).update({
    status: 'RUNNING' as JobStatus,
    startedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
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
export async function claimJob(id: string): Promise<boolean> {
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

      transaction.update(jobRef, {
        status: 'RUNNING',
        startedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    return true;
  } catch {
    return false;
  }
}

export { firestore };
