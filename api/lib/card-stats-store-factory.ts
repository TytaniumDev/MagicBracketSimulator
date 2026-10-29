/**
 * Card stats store factory: delegates to Firestore when GOOGLE_CLOUD_PROJECT
 * is set, otherwise to SQLite.
 */
import type { CardStatsStore } from './card-stats-store';
import { USE_FIRESTORE } from './env';

let _store: CardStatsStore | null = null;

export function getCardStatsStore(): CardStatsStore {
  if (_store) return _store;
  if (USE_FIRESTORE) {
    const { firestoreCardStatsStore } = require('./card-stats-store-firestore') as {
      firestoreCardStatsStore: CardStatsStore;
    };
    return (_store = firestoreCardStatsStore);
  }
  const { sqliteCardStatsStore } = require('./card-stats-store-sqlite') as {
    sqliteCardStatsStore: CardStatsStore;
  };
  return (_store = sqliteCardStatsStore);
}
