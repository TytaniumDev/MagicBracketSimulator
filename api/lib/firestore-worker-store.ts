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
 * Workers with status 'updating' get a longer threshold (5 min) to remain
 * visible during Watchtower image pulls and container restarts.
 */
export async function getActiveWorkers(staleThresholdMs = 60_000): Promise<WorkerInfo[]> {
  const UPDATING_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes for updating workers
  const maxThreshold = Math.max(staleThresholdMs, UPDATING_THRESHOLD_MS);
  const cutoff = new Date(Date.now() - maxThreshold).toISOString();
  const snapshot = await workersCollection
    .where('lastHeartbeat', '>', cutoff)
    .orderBy('lastHeartbeat', 'desc')
    .get();

  const now = Date.now();
  return snapshot.docs
    .filter((doc) => {
      const d = doc.data();
      const age = now - new Date(d.lastHeartbeat).getTime();
      return d.status === 'updating' ? age <= UPDATING_THRESHOLD_MS : age <= staleThresholdMs;
    })
    .map((doc) => {
      const d = doc.data();
      return {
        workerId: doc.id,
        workerName: d.workerName,
        status: d.status as 'idle' | 'busy' | 'updating',
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
