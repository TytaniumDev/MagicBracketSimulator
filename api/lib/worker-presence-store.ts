/**
 * Worker presence in the Realtime Database (GCP mode). See
 * shared/types/worker-presence.ts for the model.
 *
 * Desktop workers write their own entries; the API only reads them. The
 * Admin SDK bypasses database.rules.json, so it can read every entry.
 */
import { getDatabase } from 'firebase-admin/database';
import {
  PRESENCE_PATH,
  WORKER_STALE_MS,
  activeWorkersFromPresence,
} from '@shared/types/worker-presence';
import { getFirebaseAdminApp } from './firebase-admin-app';
import type { WorkerInfo } from './types';

/** Workers seen within `staleThresholdMs`, newest first. */
export async function readActiveWorkers(staleThresholdMs = WORKER_STALE_MS): Promise<WorkerInfo[]> {
  const snapshot = await getDatabase(getFirebaseAdminApp()).ref(PRESENCE_PATH).get();
  return activeWorkersFromPresence(snapshot.val(), Date.now(), staleThresholdMs);
}
