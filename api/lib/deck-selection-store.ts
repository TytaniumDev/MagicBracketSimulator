/**
 * Deck selection store interface — persists which decks are left out of deck
 * selection (the simulation picker and auto-coverage pods). Excluded decks
 * stay in the library, so their results and deck pages keep working.
 * Implemented by deck-selection-store-sqlite.ts (LOCAL) and
 * deck-selection-store-firestore.ts (GCP).
 */

export interface DeckSelectionStore {
  /** Ids of every deck excluded from selection. */
  getExcludedDeckIds(): Promise<string[]>;

  /** Exclude a deck from selection, or include it again. Returns the updated ids. */
  setDeckExcluded(deckId: string, excluded: boolean, updatedBy: string): Promise<string[]>;
}
