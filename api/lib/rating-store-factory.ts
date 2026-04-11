/**
 * Rating store factory: delegates to Firestore when GOOGLE_CLOUD_PROJECT is set,
 * otherwise to SQLite.
 */
import type { RatingStore } from './rating-store';

const USE_FIRESTORE =
  typeof process.env.GOOGLE_CLOUD_PROJECT === 'string' &&
  process.env.GOOGLE_CLOUD_PROJECT.length > 0;

let _store: RatingStore | null = null;

export function getRatingStore(): RatingStore {
  if (_store) return _store;
  if (USE_FIRESTORE) {
    const { firestoreRatingStore } = require('./rating-store-firestore') as {
      firestoreRatingStore: RatingStore;
    };
    return (_store = firestoreRatingStore);
  }
  const { sqliteRatingStore } = require('./rating-store-sqlite') as {
    sqliteRatingStore: RatingStore;
  };
  return (_store = sqliteRatingStore);
}
