/**
 * Coverage store factory: delegates to Firestore when GOOGLE_CLOUD_PROJECT is set,
 * otherwise to SQLite.
 */
import type { CoverageStore } from './coverage-store';
import { firestoreCoverageStore } from './coverage-store-firestore';
import { sqliteCoverageStore } from './coverage-store-sqlite';

const USE_FIRESTORE =
  typeof process.env.GOOGLE_CLOUD_PROJECT === 'string' &&
  process.env.GOOGLE_CLOUD_PROJECT.length > 0;

export function getCoverageStore(): CoverageStore {
  return USE_FIRESTORE ? firestoreCoverageStore : sqliteCoverageStore;
}
