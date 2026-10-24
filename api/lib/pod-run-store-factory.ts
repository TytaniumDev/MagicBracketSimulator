/**
 * Pod run store factory: delegates to Firestore when GOOGLE_CLOUD_PROJECT is set,
 * otherwise to SQLite.
 */
import type { PodRunStore } from './pod-run-store';
import { USE_FIRESTORE } from './env';

// Lazy dynamic imports so each mode only loads its own backend.
// See job-store-factory.ts for rationale.
let _store: PodRunStore | null = null;

export async function getPodRunStore(): Promise<PodRunStore> {
  if (!_store) {
    _store = USE_FIRESTORE
      ? (await import('./pod-run-store-firestore')).firestorePodRunStore
      : (await import('./pod-run-store-sqlite')).sqlitePodRunStore;
  }
  return _store;
}
