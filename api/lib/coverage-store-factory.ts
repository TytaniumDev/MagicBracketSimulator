/**
 * Coverage store factory: delegates to Firestore when GOOGLE_CLOUD_PROJECT is set,
 * otherwise to SQLite.
 */
import type { CoverageStore } from './coverage-store';

const USE_FIRESTORE =
  typeof process.env.GOOGLE_CLOUD_PROJECT === 'string' &&
  process.env.GOOGLE_CLOUD_PROJECT.length > 0;

let _store: CoverageStore | null = null;

export function getCoverageStore(): CoverageStore {
  if (_store) return _store;
  if (USE_FIRESTORE) {
    const { firestoreCoverageStore } = require('./coverage-store-firestore') as {
      firestoreCoverageStore: CoverageStore;
    };
    return (_store = firestoreCoverageStore);
  }
  const { sqliteCoverageStore } = require('./coverage-store-sqlite') as {
    sqliteCoverageStore: CoverageStore;
  };
  return (_store = sqliteCoverageStore);
}
