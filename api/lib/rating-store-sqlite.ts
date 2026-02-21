/**
 * SQLite implementation of RatingStore (LOCAL mode).
 */
import type { RatingStore, LeaderboardOptions } from './rating-store';
import type { DeckRating, MatchResult } from './types';

function getDb() {
  const { getDb: _getDb } = require('./db') as { getDb: () => import('better-sqlite3').Database };
  return _getDb();
}

export const sqliteRatingStore: RatingStore = {
  async getRating(deckId: string): Promise<DeckRating | null> {
    const db = getDb();
    const row = db
      .prepare('SELECT deck_id, mu, sigma, games_played, wins, last_updated FROM ratings WHERE deck_id = ?')
      .get(deckId) as { deck_id: string; mu: number; sigma: number; games_played: number; wins: number; last_updated: string } | undefined;
    if (!row) return null;
    return {
      deckId: row.deck_id,
      mu: row.mu,
      sigma: row.sigma,
      gamesPlayed: row.games_played,
      wins: row.wins,
      lastUpdated: row.last_updated,
    };
  },

  async updateRatings(updates: DeckRating[]): Promise<void> {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO ratings (deck_id, mu, sigma, games_played, wins, last_updated)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(deck_id) DO UPDATE SET
        mu = excluded.mu,
        sigma = excluded.sigma,
        games_played = excluded.games_played,
        wins = excluded.wins,
        last_updated = excluded.last_updated
    `);
    const runAll = db.transaction((rows: DeckRating[]) => {
      for (const r of rows) {
        stmt.run(r.deckId, r.mu, r.sigma, r.gamesPlayed, r.wins, r.lastUpdated);
      }
    });
    runAll(updates);
  },

  async recordMatchResult(result: MatchResult): Promise<void> {
    const db = getDb();
    db.prepare(`
      INSERT OR IGNORE INTO match_results (id, job_id, game_index, deck_ids, winner_deck_id, turn_count, played_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      result.id,
      result.jobId,
      result.gameIndex,
      JSON.stringify(result.deckIds),
      result.winnerDeckId ?? null,
      result.turnCount ?? null,
      result.playedAt,
    );
  },

  async hasMatchResultsForJob(jobId: string): Promise<boolean> {
    const db = getDb();
    const row = db
      .prepare('SELECT 1 FROM match_results WHERE job_id = ? LIMIT 1')
      .get(jobId);
    return row !== undefined;
  },

  async getLeaderboard(options?: LeaderboardOptions): Promise<DeckRating[]> {
    const db = getDb();
    const minGames = options?.minGames ?? 0;
    const limit = options?.limit ?? 500;
    const rows = db
      .prepare(`
        SELECT deck_id, mu, sigma, games_played, wins, last_updated
        FROM ratings
        WHERE games_played >= ?
        ORDER BY (mu - 3 * sigma) DESC
        LIMIT ?
      `)
      .all(minGames, limit) as { deck_id: string; mu: number; sigma: number; games_played: number; wins: number; last_updated: string }[];
    return rows.map((r) => ({
      deckId: r.deck_id,
      mu: r.mu,
      sigma: r.sigma,
      gamesPlayed: r.games_played,
      wins: r.wins,
      lastUpdated: r.last_updated,
    }));
  },
};
