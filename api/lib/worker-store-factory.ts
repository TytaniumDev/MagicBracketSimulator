/**
 * Worker store factory: delegates to Firestore when GOOGLE_CLOUD_PROJECT is set,
 * otherwise to SQLite (worker-store).
 */
import type { WorkerInfo } from './types';
import * as sqliteStore from './worker-store';
import * as firestoreStore from './firestore-worker-store';

const USE_FIRESTORE = typeof process.env.GOOGLE_CLOUD_PROJECT === 'string' && process.env.GOOGLE_CLOUD_PROJECT.length > 0;

export async function upsertHeartbeat(info: WorkerInfo): Promise<void> {
  if (USE_FIRESTORE) {
    await firestoreStore.upsertHeartbeat(info);
    return;
  }
  sqliteStore.upsertHeartbeat(info);
}

export async function getActiveWorkers(staleThresholdMs = 60_000): Promise<WorkerInfo[]> {
  if (USE_FIRESTORE) {
    return firestoreStore.getActiveWorkers(staleThresholdMs);
  }
  return sqliteStore.getActiveWorkers(staleThresholdMs);
}

export async function getQueueDepth(): Promise<number> {
  if (USE_FIRESTORE) {
    return firestoreStore.getQueueDepth();
  }
  return sqliteStore.getQueueDepth();
}
