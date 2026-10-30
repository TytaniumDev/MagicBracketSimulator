/**
 * SQLite implementation of DataWipeStore (LOCAL mode). User decks are .dck
 * files on disk; idempotency keys live on the job rows, so they go with them.
 */
import type { DataWipeStore, LeftoverKind } from './data-wipe-store';
import { listSavedDecks, deleteSavedDeck } from './saved-decks';

function getDb() {
  const { getDb: _getDb } = require('./db') as { getDb: () => import('better-sqlite3').Database };
  return _getDb();
}

const TABLES: Partial<Record<LeftoverKind, string>> = {
  simulations: 'simulations',
  ratings: 'ratings',
  cardStats: 'card_stats',
};

function deleteRows(table: string, limit: number): number {
  return getDb()
    .prepare(`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} LIMIT ?)`)
    .run(limit).changes;
}

function deletePodRuns(limit: number): number {
  const db = getDb();
  return db.transaction(() => {
    const ids = (db.prepare('SELECT id FROM pod_runs LIMIT ?').all(limit) as { id: string }[]).map((r) => r.id);
    for (const id of ids) {
      db.prepare('DELETE FROM pod_run_jobs WHERE pod_run_id = ?').run(id);
      db.prepare('DELETE FROM pod_runs WHERE id = ?').run(id);
    }
    return ids.length;
  })();
}

export const sqliteDataWipeStore: DataWipeStore = {
  async listJobIds(limit) {
    return (getDb().prepare('SELECT id FROM jobs LIMIT ?').all(limit) as { id: string }[]).map((r) => r.id);
  },

  async deleteLeftovers(kind, limit) {
    if (kind === 'podRuns') return deletePodRuns(limit);
    if (kind === 'idempotencyKeys') return 0;
    if (kind === 'customDecks') {
      const decks = listSavedDecks().slice(0, limit);
      for (const deck of decks) deleteSavedDeck(deck.filename);
      return decks.length;
    }
    return deleteRows(TABLES[kind]!, limit);
  },
};
