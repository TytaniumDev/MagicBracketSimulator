import { WORKER_STALE_MS } from '@shared/types/worker-presence';
import { getFirestore } from './firestore-client';
import { readActiveWorkers } from './worker-presence-store';
import type { WorkerInfo } from './types';

const firestore = getFirestore();
const jobsCollection = firestore.collection('jobs');

/**
 * Workers seen within the stale threshold (3 minutes by default, 3x the
 * desktop worker's 60-second presence write), read from Realtime Database
 * presence.
 */
export async function getActiveWorkers(staleThresholdMs = WORKER_STALE_MS): Promise<WorkerInfo[]> {
  return readActiveWorkers(staleThresholdMs);
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
