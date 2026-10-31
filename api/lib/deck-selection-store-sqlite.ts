/**
 * SQLite implementation of DeckSelectionStore (LOCAL mode).
 */
import type { DeckSelectionStore } from './deck-selection-store';

function getDb() {
  const { getDb: _getDb } = require('./db') as { getDb: () => import('better-sqlite3').Database };
  return _getDb();
}

export const sqliteDeckSelectionStore: DeckSelectionStore = {
  async getExcludedDeckIds(): Promise<string[]> {
    const rows = getDb().prepare('SELECT deck_id FROM excluded_decks ORDER BY deck_id').all() as { deck_id: string }[];
    return rows.map((r) => r.deck_id);
  },

  async setDecksExcluded(deckIds, excluded, updatedBy): Promise<string[]> {
    const db = getDb();
    const stmt = excluded
      ? db.prepare(`
          INSERT INTO excluded_decks (deck_id, updated_at, updated_by)
          VALUES (?, ?, ?)
          ON CONFLICT(deck_id) DO NOTHING
        `)
      : db.prepare('DELETE FROM excluded_decks WHERE deck_id = ?');
    const now = new Date().toISOString();
    db.transaction(() => {
      for (const deckId of deckIds) {
        if (excluded) stmt.run(deckId, now, updatedBy);
        else stmt.run(deckId);
      }
    })();
    return this.getExcludedDeckIds();
  },
};
