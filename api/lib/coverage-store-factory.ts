/**
 * Coverage store factory: delegates to Firestore when GOOGLE_CLOUD_PROJECT is set,
 * otherwise to SQLite.
 */
import type { CoverageStore } from './coverage-store';
import { firestoreCoverageStore } from './coverage-store-firestore';

const USE_FIRESTORE =
  typeof process.env.GOOGLE_CLOUD_PROJECT === 'string' &&
  process.env.GOOGLE_CLOUD_PROJECT.length > 0;

// Lazy dynamic import of the SQLite-backed coverage store.
// See job-store-factory.ts for rationale.
let _sqliteStore: CoverageStore | null = null;
async function getSqliteStore(): Promise<CoverageStore> {
  if (!_sqliteStore) {
    const mod = await import('./coverage-store-sqlite');
    _sqliteStore = mod.sqliteCoverageStore;
  }
  return _sqliteStore;
}

export async function getCoverageStore(): Promise<CoverageStore> {
  return USE_FIRESTORE ? firestoreCoverageStore : getSqliteStore();
}
