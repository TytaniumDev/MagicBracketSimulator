import { firestore } from './firestore-job-store';
import type { WorkerInfo } from './types';

const workersCollection = firestore.collection('workers');
const jobsCollection = firestore.collection('jobs');

/**
 * Upsert a worker heartbeat record.
 */
export async function upsertHeartbeat(info: WorkerInfo): Promise<void> {
  await workersCollection.doc(info.workerId).set({
    workerName: info.workerName,
    status: info.status,
    currentJobId: info.currentJobId ?? null,
    capacity: info.capacity,
    activeSimulations: info.activeSimulations,
    uptimeMs: info.uptimeMs,
    lastHeartbeat: info.lastHeartbeat,
    version: info.version ?? null,
  });
}

/**
 * Get workers whose last heartbeat is within the stale threshold.
 */
export async function getActiveWorkers(staleThresholdMs = 60_000): Promise<WorkerInfo[]> {
  const cutoff = new Date(Date.now() - staleThresholdMs).toISOString();
  const snapshot = await workersCollection
    .where('lastHeartbeat', '>', cutoff)
    .orderBy('lastHeartbeat', 'desc')
    .get();

  return snapshot.docs.map((doc) => {
    const d = doc.data();
    return {
      workerId: doc.id,
      workerName: d.workerName,
      status: d.status as 'idle' | 'busy',
      ...(d.currentJobId && { currentJobId: d.currentJobId }),
      capacity: d.capacity ?? 0,
      activeSimulations: d.activeSimulations ?? 0,
      uptimeMs: d.uptimeMs ?? 0,
      lastHeartbeat: d.lastHeartbeat,
      ...(d.version && { version: d.version }),
    };
  });
}

/**
 * Count of QUEUED jobs.
 */
export async function getQueueDepth(): Promise<number> {
  const snapshot = await jobsCollection
    .where('status', '==', 'QUEUED')
    .count()
    .get();
  return snapshot.data().count;
}
