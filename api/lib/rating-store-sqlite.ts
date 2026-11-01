/**
 * SQLite implementation of RatingStore (LOCAL mode). Pair game counts live
 * in `ratings.pair_games` (JSON); `jobs.ratings_applied` marks applied jobs.
 */
import { addPodPairGames, pairKey, type RatingJobUpdate, type RatingStore, type LeaderboardOptions } from './rating-store';
import type { DeckRating } from './types';

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

const RATING_COLUMNS =
  'deck_id, mu, sigma, games_played, wins, last_updated, win_turn_sum, win_turn_wins, win_turn_histogram';

function readRating(deckId: string): DeckRating | null {
  const row = getDb()
    .prepare(`SELECT ${RATING_COLUMNS} FROM ratings WHERE deck_id = ? AND games_played > 0`)
    .get(deckId) as RatingRow | undefined;
  return row ? rowToRating(row) : null;
}

function readPairGames(deckId: string): Record<string, number> {
  const row = getDb().prepare('SELECT pair_games FROM ratings WHERE deck_id = ?').get(deckId) as
    | { pair_games: string | null }
    | undefined;
  return row?.pair_games ? (JSON.parse(row.pair_games) as Record<string, number>) : {};
}

/**
 * Apply a job to its decks' ratings, or take it back, in one transaction
 * that also flips `jobs.ratings_applied`.
 */
function changeJob({ jobId, deckIds, gameCount, update }: RatingJobUpdate, change: 'apply' | 'remove'): boolean {
  const db = getDb();
  const applying = change === 'apply';
  const upsertRating = db.prepare(`
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
  const upsertPairGames = db.prepare(`
    INSERT INTO ratings (deck_id, games_played, wins, last_updated, pair_games) VALUES (?, 0, 0, ?, ?)
    ON CONFLICT(deck_id) DO UPDATE SET pair_games = excluded.pair_games
  `);

  return db.transaction(() => {
    const job = db.prepare('SELECT ratings_applied FROM jobs WHERE id = ?').get(jobId) as
      | { ratings_applied: number | null }
      | undefined;
    if (!job || Boolean(job.ratings_applied) === applying) return false;

    const next = update(deckIds.map(readRating));
    for (const r of next ?? []) {
      if (!r) continue;
      upsertRating.run(
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

    const now = new Date().toISOString();
    const counts = new Map(deckIds.map((id) => [id, readPairGames(id)]));
    for (const [deckId, deckCounts] of addPodPairGames(counts, deckIds, applying ? gameCount : -gameCount)) {
      upsertPairGames.run(deckId, now, JSON.stringify(deckCounts));
    }

    db.prepare('UPDATE jobs SET ratings_applied = ? WHERE id = ?').run(applying ? 1 : 0, jobId);
    return true;
  })();
}

export const sqliteRatingStore: RatingStore = {
  async getRating(deckId: string): Promise<DeckRating | null> {
    return readRating(deckId);
  },

  async applyJob(job): Promise<boolean> {
    return changeJob(job, 'apply');
  },

  async removeJob(job): Promise<boolean> {
    return changeJob(job, 'remove');
  },

  async getLeaderboard(options?: LeaderboardOptions): Promise<DeckRating[]> {
    const minGames = Math.max(options?.minGames ?? 0, 1);
    const limit = options?.limit ?? 500;
    const rows = getDb()
      .prepare(`
        SELECT ${RATING_COLUMNS}
        FROM ratings
        WHERE games_played >= ?
        ORDER BY (mu - 3 * sigma) DESC
        LIMIT ?
      `)
      .all(minGames, limit) as RatingRow[];
    return rows.map(rowToRating);
  },

  async getPairGameCounts(): Promise<Map<string, number>> {
    const rows = getDb().prepare('SELECT deck_id, pair_games FROM ratings WHERE pair_games IS NOT NULL').all() as {
      deck_id: string;
      pair_games: string;
    }[];
    const counts = new Map<string, number>();
    for (const row of rows) {
      for (const [other, games] of Object.entries(JSON.parse(row.pair_games) as Record<string, number>)) {
        if (row.deck_id < other) counts.set(pairKey(row.deck_id, other), games);
      }
    }
    return counts;
  },
};
