/**
 * Worker store factory: delegates to Firestore when GOOGLE_CLOUD_PROJECT is set,
 * otherwise to SQLite (worker-store).
 */
import * as sqliteStore from './worker-store';
import * as firestoreStore from './firestore-worker-store';

export type WorkerRecord = import('./worker-store').WorkerRecord;

const USE_FIRESTORE =
  typeof process.env.GOOGLE_CLOUD_PROJECT === 'string' && process.env.GOOGLE_CLOUD_PROJECT.length > 0;

export async function setCurrentRefreshId(refreshId: string): Promise<void> {
  if (USE_FIRESTORE) {
    await firestoreStore.setCurrentRefreshId(refreshId);
  } else {
    sqliteStore.setCurrentRefreshId(refreshId);
  }
}

export async function upsertWorker(
  workerId: string,
  data: { hostname?: string; subscription?: string; refreshId: string }
): Promise<void> {
  if (USE_FIRESTORE) {
    await firestoreStore.upsertWorker(workerId, data);
  } else {
    sqliteStore.upsertWorker(workerId, data);
  }
}

export async function listWorkers(): Promise<WorkerRecord[]> {
  if (USE_FIRESTORE) {
    return firestoreStore.listWorkers();
  }
  return sqliteStore.listWorkers();
}

export async function getCurrentRefreshId(): Promise<string> {
  if (USE_FIRESTORE) {
    return firestoreStore.getCurrentRefreshId();
  }
  return sqliteStore.getCurrentRefreshId();
}

export async function cleanupOldWorkers(): Promise<void> {
  if (USE_FIRESTORE) {
    await firestoreStore.cleanupOldWorkers();
  } else {
    sqliteStore.cleanupOldWorkers();
  }
}
