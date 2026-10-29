/**
 * Worker presence in the Realtime Database (GCP mode). See
 * shared/types/worker-presence.ts for the model.
 *
 * The Admin SDK bypasses database.rules.json, so the API can write Docker
 * workers' entries (which carry no uid) and read every entry.
 */
import { getDatabase, ServerValue } from 'firebase-admin/database';
import {
  PRESENCE_PATH,
  WORKER_STALE_MS,
  activeWorkersFromPresence,
  type WorkerPresence,
} from '@shared/types/worker-presence';
import { getFirebaseAdminApp } from './firebase-admin-app';
import type { WorkerInfo } from './types';

function presenceRef(workerId?: string) {
  const db = getDatabase(getFirebaseAdminApp());
  return db.ref(workerId ? `${PRESENCE_PATH}/${workerId}` : PRESENCE_PATH);
}

/**
 * Write a heartbeat into the worker's presence entry. Fields not passed
 * (such as maxConcurrentOverride) keep their stored value.
 */
export async function writePresence(
  info: WorkerInfo,
  extra: Pick<WorkerPresence, 'maxConcurrentOverride'> = {},
): Promise<void> {
  await presenceRef(info.workerId).update({
    workerName: info.workerName,
    workerType: info.workerType ?? 'docker',
    status: info.status,
    currentJobId: info.currentJobId ?? null,
    capacity: info.capacity,
    activeSimulations: info.activeSimulations,
    uptimeMs: info.uptimeMs,
    lastSeen: ServerValue.TIMESTAMP,
    version: info.version ?? null,
    ownerEmail: info.ownerEmail ?? null,
    workerApiUrl: info.workerApiUrl ?? null,
    ...extra,
  });
}

/** Copy a changed concurrency override into the worker's entry so the UI shows it. */
export async function setPresenceOverride(workerId: string, override: number | null): Promise<void> {
  await presenceRef(workerId).update({ maxConcurrentOverride: override });
}

/** Workers seen within `staleThresholdMs`, newest first. */
export async function readActiveWorkers(staleThresholdMs = WORKER_STALE_MS): Promise<WorkerInfo[]> {
  const snapshot = await presenceRef().get();
  return activeWorkersFromPresence(snapshot.val(), Date.now(), staleThresholdMs);
}
