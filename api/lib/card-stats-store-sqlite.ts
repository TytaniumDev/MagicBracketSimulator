/**
 * SQLite implementation of CardStatsStore (LOCAL mode). Stores each deck's
 * counters as one JSON row.
 */
import type { CardStatsStore } from './card-stats-store';
import { emptyDeckCardStats } from './card-impact/stats';
import type { DeckCardStats } from '@shared/types/card-impact';

function getDb() {
  const { getDb: _getDb } = require('./db') as { getDb: () => import('better-sqlite3').Database };
  return _getDb();
}

function read(deckId: string): DeckCardStats | null {
  const row = getDb()
    .prepare('SELECT data_json FROM card_stats WHERE deck_id = ?')
    .get(deckId) as { data_json: string } | undefined;
  return row ? (JSON.parse(row.data_json) as DeckCardStats) : null;
}

export const sqliteCardStatsStore: CardStatsStore = {
  async get(deckId: string): Promise<DeckCardStats | null> {
    return read(deckId);
  },

  async addJob(deckId, jobId, update): Promise<boolean> {
    const db = getDb();
    return db.transaction(() => {
      const current = read(deckId) ?? emptyDeckCardStats();
      if (current.jobIds.includes(jobId)) return false;
      const next = { ...update(current), jobIds: [...current.jobIds, jobId] };
      db.prepare(
        'INSERT INTO card_stats (deck_id, data_json) VALUES (?, ?) ON CONFLICT(deck_id) DO UPDATE SET data_json = excluded.data_json',
      ).run(deckId, JSON.stringify(next));
      return true;
    })();
  },
};
