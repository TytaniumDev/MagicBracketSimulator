/**
 * Worker store factory: delegates to Firestore + Realtime Database presence
 * when GOOGLE_CLOUD_PROJECT is set, otherwise to SQLite (worker-store).
 */
import type { WorkerInfo } from './types';
import * as firestoreStore from './firestore-worker-store';
import { USE_FIRESTORE } from './env';

// Lazy dynamic import — see job-store-factory.ts for rationale.
type SqliteWorkerStore = typeof import('./worker-store');
let _sqliteStore: SqliteWorkerStore | null = null;
async function sqliteStore(): Promise<SqliteWorkerStore> {
  if (!_sqliteStore) {
    _sqliteStore = await import('./worker-store');
  }
  return _sqliteStore;
}

export async function getActiveWorkers(staleThresholdMs?: number): Promise<WorkerInfo[]> {
  if (USE_FIRESTORE) {
    return firestoreStore.getActiveWorkers(staleThresholdMs);
  }
  return (await sqliteStore()).getActiveWorkers();
}

export async function getQueueDepth(): Promise<number> {
  if (USE_FIRESTORE) {
    return firestoreStore.getQueueDepth();
  }
  return (await sqliteStore()).getQueueDepth();
}
