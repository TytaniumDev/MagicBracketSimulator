import { Timestamp, FieldValue, FieldPath } from '@google-cloud/firestore';
import { Job, JobStatus, JobResults, DeckSlot, SimulationStatus, SimulationState, JobSource } from './types';
import { getFirestore } from './firestore-client';

const firestore = getFirestore();

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
    dockerRunDurationsMs: data.dockerRunDurationsMs,
    ...(data.workerId && { workerId: data.workerId }),
    ...(data.workerName && { workerName: data.workerName }),
    ...(data.claimedAt && { claimedAt: data.claimedAt.toDate() }),
    ...(data.retryCount != null && data.retryCount > 0 && { retryCount: data.retryCount }),
    ...(data.needsAggregation === true && { needsAggregation: true }),
    ...(data.completedSimCount != null && { completedSimCount: data.completedSimCount }),
    ...(data.totalSimCount != null && { totalSimCount: data.totalSimCount }),
    ...(data.results != null && { results: data.results as JobResults }),
    ...(data.source && data.source !== 'user' && { source: data.source }),
  };
}

export interface CreateJobData {
  decks: DeckSlot[];
  simulations: number;
  parallelism?: number;
  idempotencyKey?: string;
  createdBy: string;
  deckIds?: string[];
  source?: JobSource;
  /**
   * Denormalized deck metadata, keyed by deck NAME (matches deckNames[]).
   * Writing these into the job doc at creation time eliminates 4 Firestore
   * deck reads per job view (Browse + detail pages) and massively reduces
   * the leaderboard's read fan-out.
   */
  deckLinks?: Record<string, string | null>;
  colorIdentity?: Record<string, string[]>;
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
    ...(data.deckLinks && Object.keys(data.deckLinks).length > 0 && { deckLinks: data.deckLinks }),
    ...(data.colorIdentity && Object.keys(data.colorIdentity).length > 0 && { colorIdentity: data.colorIdentity }),
    status: 'QUEUED' as JobStatus,
    simulations: data.simulations,
    parallelism: data.parallelism || 4,
    createdAt: now,
    createdBy: data.createdBy,
    idempotencyKey: data.idempotencyKey || null,
    source: data.source ?? 'user',
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
      // TTL: auto-delete idempotency keys after 7 days (requires Firestore TTL policy on 'ttl' field)
      const idempotencyTtl = Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
      transaction.set(jobRef, jobData);
      transaction.set(idempotencyRef, {
        jobId: jobRef.id,
        createdAt: now,
        ttl: idempotencyTtl,
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
    ...(data.source && data.source !== 'user' && { source: data.source }),
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
 * Conditionally update a job's status using a Firestore transaction.
 * Only applies the update if the job is currently in one of the expectedStatuses.
 * Returns true if the update was applied, false if the status had already changed.
 */
export async function conditionalUpdateJobStatus(
  id: string,
  expectedStatuses: JobStatus[],
  newStatus: JobStatus,
  metadata?: { workerId?: string; workerName?: string }
): Promise<boolean> {
  const jobRef = jobsCollection.doc(id);

  return firestore.runTransaction(async (transaction) => {
    const doc = await transaction.get(jobRef);
    if (!doc.exists) return false;

    const currentStatus = doc.data()!.status as JobStatus;
    if (!expectedStatuses.includes(currentStatus)) return false;

    const updateData: Record<string, unknown> = {
      status: newStatus,
      startedAt: FieldValue.serverTimestamp(),
      claimedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (metadata?.workerId) {
      updateData.workerId = metadata.workerId;
    }
    if (metadata?.workerName) {
      updateData.workerName = metadata.workerName;
    }

    transaction.update(jobRef, updateData);
    return true;
  });
}

/**
 * Set or clear the needsAggregation flag on a job.
 */
export async function setNeedsAggregation(id: string, value: boolean): Promise<void> {
  await jobsCollection.doc(id).update({
    needsAggregation: value,
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
 * Store aggregated results on the job document.
 */
export async function setJobResults(jobId: string, results: JobResults): Promise<void> {
  await jobsCollection.doc(jobId).update({ results });
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

export interface ListJobsOptions {
  userId?: string;
  limit?: number;
  /** Opaque cursor returned from a previous call's `nextCursor`. */
  cursor?: string;
}

export interface ListJobsResult {
  jobs: Job[];
  nextCursor: string | null;
}

const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 200;

/**
 * Composite pagination cursor: ISO createdAt + document id. The id is
 * the tie-breaker for the rare case where two jobs share the exact same
 * `createdAt` millisecond (e.g. batch imports), ensuring no job is ever
 * skipped or duplicated across page boundaries. Wire format is
 * base64(JSON({ts, id})). Legacy timestamp-only cursors (from the first
 * cut of this endpoint) are still accepted for backward compat.
 */
interface ListJobsCursor {
  ts: string;
  id: string;
}

function encodeCursor(cursor: ListJobsCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf-8').toString('base64');
}

function decodeCursor(raw: string): ListJobsCursor | null {
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf-8');
    if (decoded.startsWith('{')) {
      const parsed = JSON.parse(decoded) as Partial<ListJobsCursor>;
      if (parsed && typeof parsed.ts === 'string' && typeof parsed.id === 'string') {
        if (isNaN(new Date(parsed.ts).getTime())) return null;
        return { ts: parsed.ts, id: parsed.id };
      }
      return null;
    }
    // Legacy timestamp-only cursor
    if (!isNaN(new Date(decoded).getTime())) {
      return { ts: decoded, id: '' };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * List jobs, optionally filtered by user. Results are cursor-paginated in
 * descending (createdAt, id) order. Pass `options.cursor` from a previous
 * result's `nextCursor` to fetch the next page; `nextCursor === null`
 * means no more results.
 */
export async function listJobs(options: ListJobsOptions = {}): Promise<ListJobsResult> {
  const limit = Math.max(1, Math.min(options.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT));

  // Order by (createdAt DESC, __name__ DESC) so document id is a stable
  // tie-breaker within the same millisecond.
  let query: FirebaseFirestore.Query = jobsCollection
    .orderBy('createdAt', 'desc')
    .orderBy(FieldPath.documentId(), 'desc');

  if (options.userId) {
    query = query.where('createdBy', '==', options.userId);
  }

  if (options.cursor) {
    const parsed = decodeCursor(options.cursor);
    if (parsed) {
      const ts = Timestamp.fromDate(new Date(parsed.ts));
      if (parsed.id) {
        query = query.startAfter(ts, parsed.id);
      } else {
        // Legacy cursor — best-effort, may lose ties on the boundary
        query = query.startAfter(ts);
      }
    }
  }

  const snapshot = await query.limit(limit + 1).get();
  const rawJobs = snapshot.docs
    .map(doc => docToJob(doc))
    .filter((job): job is Job => job !== null);

  const hasMore = rawJobs.length > limit;
  const jobs = hasMore ? rawJobs.slice(0, limit) : rawJobs;
  const nextCursor = hasMore && jobs.length > 0
    ? encodeCursor({
        ts: jobs[jobs.length - 1].createdAt.toISOString(),
        id: jobs[jobs.length - 1].id,
      })
    : null;

  return { jobs, nextCursor };
}

export async function listActiveJobs(): Promise<Job[]> {
  const snapshot = await jobsCollection
    .where('status', 'in', ['QUEUED', 'RUNNING'])
    .orderBy('createdAt', 'asc')
    .get();
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

  // Update PENDING and RUNNING simulations to CANCELLED in batches
  const simCol = simulationsCollection(id);
  const [pendingSims, runningSims] = await Promise.all([
    simCol.where('state', '==', 'PENDING').get(),
    simCol.where('state', '==', 'RUNNING').get(),
  ]);

  const simsToCancel = [...pendingSims.docs, ...runningSims.docs];
  if (simsToCancel.length > 0) {
    const batchSize = 500;
    for (let i = 0; i < simsToCancel.length; i += batchSize) {
      const batch = firestore.batch();
      const slice = simsToCancel.slice(i, i + batchSize);
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
 * Atomically claim the next PENDING simulation across any active (QUEUED or
 * RUNNING) job. Scans up to 10 oldest active jobs for one with a PENDING sim;
 * uses a transaction to flip that sim to RUNNING (and promote the job from
 * QUEUED to RUNNING if needed). Transaction conflicts cause the loop to try
 * the next candidate, so concurrent workers do not collide on the same sim.
 */
export async function claimNextSim(
  workerId: string,
  workerName: string,
): Promise<{ jobId: string; simId: string; simIndex: number } | null> {
  const candidates = await jobsCollection
    .where('status', 'in', ['QUEUED', 'RUNNING'])
    .orderBy('createdAt', 'asc')
    .limit(10)
    .get();

  for (const jobDoc of candidates.docs) {
    const jobData = jobDoc.data();
    const completed = jobData.completedSimCount ?? 0;
    const total = jobData.totalSimCount ?? 0;
    if (total > 0 && completed >= total) continue;

    const pending = await simulationsCollection(jobDoc.id)
      .where('state', '==', 'PENDING')
      .orderBy('index', 'asc')
      .limit(1)
      .get();
    if (pending.empty) continue;

    const simDocSnap = pending.docs[0];

    try {
      const claimed = await firestore.runTransaction(async (tx) => {
        const freshSim = await tx.get(simDocSnap.ref);
        if (!freshSim.exists) return null;
        const simData = freshSim.data();
        if (simData?.state !== 'PENDING') return null;

        const freshJob = await tx.get(jobDoc.ref);
        if (!freshJob.exists) return null;
        const jobStatus = freshJob.data()?.status;
        if (jobStatus !== 'QUEUED' && jobStatus !== 'RUNNING') return null;

        tx.update(simDocSnap.ref, {
          state: 'RUNNING',
          workerId,
          workerName,
          startedAt: new Date().toISOString(),
        });

        if (jobStatus === 'QUEUED') {
          tx.update(jobDoc.ref, {
            status: 'RUNNING',
            startedAt: FieldValue.serverTimestamp(),
            claimedAt: FieldValue.serverTimestamp(),
            workerId,
            workerName,
            updatedAt: FieldValue.serverTimestamp(),
          });
        }

        return {
          jobId: jobDoc.id,
          simId: simDocSnap.id,
          simIndex: (simData?.index ?? 0) as number,
        };
      });

      if (claimed) return claimed;
      // Lost the race on this sim — try the next candidate job.
    } catch {
      // Transaction retry exhaustion — move on, another poll will find it.
      continue;
    }
  }

  return null;
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
 * Also sets atomic counters on the job document for O(1) completion checks.
 */
export async function initializeSimulations(
  jobId: string,
  count: number
): Promise<void> {
  // Set atomic counters on the job document
  await jobsCollection.doc(jobId).update({
    completedSimCount: 0,
    totalSimCount: count,
  });

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
 * Atomically increment the completed simulation counter.
 * Returns the updated job data (including the new counter value).
 */
export async function incrementCompletedSimCount(
  jobId: string,
): Promise<{ completedSimCount: number; totalSimCount: number }> {
  const jobRef = jobsCollection.doc(jobId);

  // Increment the counter atomically
  await jobRef.update({
    completedSimCount: FieldValue.increment(1),
  });

  // Read the updated document to get the new counter value
  const doc = await jobRef.get();
  const data = doc.data()!;
  return {
    completedSimCount: data.completedSimCount ?? 0,
    totalSimCount: data.totalSimCount ?? 0,
  };
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
  if (update.winners !== undefined) updateData.winners = update.winners;
  if (update.winningTurns !== undefined) updateData.winningTurns = update.winningTurns;

  await simulationsCollection(jobId).doc(simId).update(updateData);
}

/**
 * Conditionally update a simulation's status using a Firestore transaction.
 * Only applies the update if the sim is currently in one of the expectedStates.
 * Returns true if the update was applied, false if the state had already changed.
 */
export async function conditionalUpdateSimulationStatus(
  jobId: string,
  simId: string,
  expectedStates: SimulationState[],
  update: Partial<SimulationStatus>
): Promise<boolean> {
  const simRef = simulationsCollection(jobId).doc(simId);

  return firestore.runTransaction(async (transaction) => {
    const doc = await transaction.get(simRef);
    if (!doc.exists) return false;

    const currentState = doc.data()!.state as SimulationState;
    if (!expectedStates.includes(currentState)) return false;

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
    if (update.winners !== undefined) updateData.winners = update.winners;
    if (update.winningTurns !== undefined) updateData.winningTurns = update.winningTurns;

    transaction.update(simRef, updateData);
    return true;
  });
}

/**
 * Get a single simulation's status.
 */
export async function getSimulationStatus(
  jobId: string,
  simId: string
): Promise<SimulationStatus | null> {
  const doc = await simulationsCollection(jobId).doc(simId).get();
  if (!doc.exists) return null;

  const data = doc.data()!;
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
    ...(data.winners?.length > 0 && { winners: data.winners }),
    ...(data.winningTurns?.length > 0 && { winningTurns: data.winningTurns }),
  } as SimulationStatus;
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
      ...(data.winners?.length > 0 && { winners: data.winners }),
      ...(data.winningTurns?.length > 0 && { winningTurns: data.winningTurns }),
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

