import { WORKER_STALE_MS } from '@shared/types/worker-presence';
import { getFirestore } from './firestore-client';
import { readActiveWorkers, setPresenceOverride, writePresence } from './worker-presence-store';
import type { WorkerInfo } from './types';

const firestore = getFirestore();
const workersCollection = firestore.collection('workers');
const jobsCollection = firestore.collection('jobs');

/**
 * Durable worker fields last written to `workers/{id}` by this API instance,
 * so a heartbeat only writes Firestore when they change (or on the first
 * heartbeat this instance sees).
 */
const registeredWorkers = new Map<string, string>();

/**
 * Record a worker heartbeat.
 *
 * Liveness goes to Realtime Database presence (`presence/{workerId}`), which
 * costs no Firestore operations. The Firestore `workers/{id}` doc keeps only
 * durable fields (name, owner, push URL, version, concurrency override) and
 * is written when they change, not on every beat.
 */
export async function upsertHeartbeat(info: WorkerInfo): Promise<void> {
  const durable = {
    workerName: info.workerName,
    workerType: info.workerType ?? 'docker',
    version: info.version ?? null,
    ownerEmail: info.ownerEmail ?? null,
    workerApiUrl: info.workerApiUrl ?? null,
  };
  const key = JSON.stringify(durable);
  if (registeredWorkers.get(info.workerId) === key) {
    await writePresence(info);
    return;
  }

  const docRef = workersCollection.doc(info.workerId);
  await docRef.set(durable, { merge: true });
  const override = (await docRef.get()).data()?.maxConcurrentOverride ?? null;
  await writePresence(info, { maxConcurrentOverride: override });
  registeredWorkers.set(info.workerId, key);
}

/**
 * Workers seen within the stale threshold (3 minutes by default, 3x the
 * Docker worker's 60-second heartbeat), read from Realtime Database
 * presence. Workers with status 'updating' get 5 minutes to stay visible
 * during image pulls and container restarts.
 */
export async function getActiveWorkers(staleThresholdMs = WORKER_STALE_MS): Promise<WorkerInfo[]> {
  return readActiveWorkers(staleThresholdMs);
}

/**
 * Get the max concurrent override for a worker. Returns null if not set or worker not found.
 */
export async function getMaxConcurrentOverride(workerId: string): Promise<number | null> {
  const doc = await workersCollection.doc(workerId).get();
  if (!doc.exists) return null;
  return doc.data()?.maxConcurrentOverride ?? null;
}

/**
 * Set the max concurrent override for a worker. Pass null to clear.
 * Returns true if the worker was found and updated.
 */
export async function setMaxConcurrentOverride(workerId: string, override: number | null): Promise<boolean> {
  const doc = await workersCollection.doc(workerId).get();
  if (!doc.exists) return false;
  await workersCollection.doc(workerId).update({ maxConcurrentOverride: override });
  await setPresenceOverride(workerId, override);
  return true;
}

/**
 * Get the worker API URL for a specific worker. Returns null if not set or worker not found.
 */
export async function getWorkerApiUrl(workerId: string): Promise<string | null> {
  const doc = await workersCollection.doc(workerId).get();
  if (!doc.exists) return null;
  return doc.data()?.workerApiUrl ?? null;
}

/**
 * Get the owner email for a worker. Returns null if not set or worker not found.
 */
export async function getOwnerEmail(workerId: string): Promise<string | null> {
  const doc = await workersCollection.doc(workerId).get();
  if (!doc.exists) return null;
  return doc.data()?.ownerEmail ?? null;
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
