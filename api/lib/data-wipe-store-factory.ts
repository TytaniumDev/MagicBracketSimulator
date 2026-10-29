/**
 * Data wipe store factory: delegates to Firestore when GOOGLE_CLOUD_PROJECT
 * is set, otherwise to SQLite.
 */
import type { DataWipeStore } from './data-wipe-store';
import { USE_FIRESTORE } from './env';

let _store: DataWipeStore | null = null;

export function getDataWipeStore(): DataWipeStore {
  if (_store) return _store;
  if (USE_FIRESTORE) {
    const { firestoreDataWipeStore } = require('./data-wipe-store-firestore') as {
      firestoreDataWipeStore: DataWipeStore;
    };
    return (_store = firestoreDataWipeStore);
  }
  const { sqliteDataWipeStore } = require('./data-wipe-store-sqlite') as {
    sqliteDataWipeStore: DataWipeStore;
  };
  return (_store = sqliteDataWipeStore);
}
