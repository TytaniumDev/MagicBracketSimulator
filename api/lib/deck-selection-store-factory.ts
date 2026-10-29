/**
 * Deck selection store factory: delegates to Firestore when GOOGLE_CLOUD_PROJECT is set,
 * otherwise to SQLite.
 */
import type { DeckSelectionStore } from './deck-selection-store';
import { firestoreDeckSelectionStore } from './deck-selection-store-firestore';
import { USE_FIRESTORE } from './env';

// Lazy dynamic import of the SQLite-backed store.
// See job-store-factory.ts for rationale.
let _sqliteStore: DeckSelectionStore | null = null;
async function getSqliteStore(): Promise<DeckSelectionStore> {
  if (!_sqliteStore) {
    const mod = await import('./deck-selection-store-sqlite');
    _sqliteStore = mod.sqliteDeckSelectionStore;
  }
  return _sqliteStore;
}

export async function getDeckSelectionStore(): Promise<DeckSelectionStore> {
  return USE_FIRESTORE ? firestoreDeckSelectionStore : getSqliteStore();
}
