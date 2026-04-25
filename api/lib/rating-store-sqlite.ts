/**
 * SQLite implementation of RatingStore (LOCAL mode).
 */
import type { RatingStore, LeaderboardOptions } from './rating-store';
import type { DeckRating, MatchResult } from './types';

function getDb() {
  const { getDb: _getDb } = require('./db') as { getDb: () => import('better-sqlite3').Database };
  return _getDb();
}

type RatingRow = {
  deck_id: string;
  mu: number;
  sigma: number;
  games_played: number;
  wins: number;
  last_updated: string;
  win_turn_sum: number | null;
  win_turn_wins: number | null;
  win_turn_histogram: string | null;
};

function rowToRating(row: RatingRow): DeckRating {
  const base: DeckRating = {
    deckId: row.deck_id,
    mu: row.mu,
    sigma: row.sigma,
    gamesPlayed: row.games_played,
    wins: row.wins,
    lastUpdated: row.last_updated,
  };
  if (row.win_turn_sum != null) base.winTurnSum = row.win_turn_sum;
  if (row.win_turn_wins != null) base.winTurnWins = row.win_turn_wins;
  if (row.win_turn_histogram) {
    try {
      const parsed = JSON.parse(row.win_turn_histogram) as unknown;
      if (
        Array.isArray(parsed) &&
        parsed.length === 16 &&
        parsed.every((n) => typeof n === 'number')
      ) {
        base.winTurnHistogram = parsed as number[];
      }
    } catch {
      // Ignore malformed histogram JSON — treat as missing.
    }
  }
  return base;
}

export const sqliteRatingStore: RatingStore = {
  async getRating(deckId: string): Promise<DeckRating | null> {
    const db = getDb();
    const row = db
      .prepare(
        'SELECT deck_id, mu, sigma, games_played, wins, last_updated, win_turn_sum, win_turn_wins, win_turn_histogram FROM ratings WHERE deck_id = ?',
      )
      .get(deckId) as RatingRow | undefined;
    if (!row) return null;
    return rowToRating(row);
  },

  async updateRatings(updates: DeckRating[]): Promise<void> {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO ratings (deck_id, mu, sigma, games_played, wins, last_updated, win_turn_sum, win_turn_wins, win_turn_histogram)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(deck_id) DO UPDATE SET
        mu = excluded.mu,
        sigma = excluded.sigma,
        games_played = excluded.games_played,
        wins = excluded.wins,
        last_updated = excluded.last_updated,
        win_turn_sum = excluded.win_turn_sum,
        win_turn_wins = excluded.win_turn_wins,
        win_turn_histogram = excluded.win_turn_histogram
    `);
    const runAll = db.transaction((rows: DeckRating[]) => {
      for (const r of rows) {
        stmt.run(
          r.deckId,
          r.mu,
          r.sigma,
          r.gamesPlayed,
          r.wins,
          r.lastUpdated,
          r.winTurnSum ?? null,
          r.winTurnWins ?? null,
          r.winTurnHistogram ? JSON.stringify(r.winTurnHistogram) : null,
        );
      }
    });
    runAll(updates);
  },

  async recordMatchResults(results: MatchResult[]): Promise<void> {
    if (results.length === 0) return;
    const db = getDb();
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO match_results (id, job_id, game_index, deck_ids, winner_deck_id, turn_count, played_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const runAll = db.transaction((rows: MatchResult[]) => {
      for (const r of rows) {
        stmt.run(
          r.id,
          r.jobId,
          r.gameIndex,
          JSON.stringify(r.deckIds),
          r.winnerDeckId ?? null,
          r.turnCount ?? null,
          r.playedAt,
        );
      }
    });
    runAll(results);
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
        SELECT deck_id, mu, sigma, games_played, wins, last_updated, win_turn_sum, win_turn_wins, win_turn_histogram
        FROM ratings
        WHERE games_played >= ?
        ORDER BY (mu - 3 * sigma) DESC
        LIMIT ?
      `)
      .all(minGames, limit) as RatingRow[];
    return rows.map(rowToRating);
  },
};
