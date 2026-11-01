/**
 * Rating store interface — persists each deck's win stats and how many
 * games it has played against every other deck.
 * Implemented by rating-store-sqlite.ts (LOCAL) and rating-store-firestore.ts (GCP).
 */
import type { DeckRating } from './types';

export type { DeckRating };

export interface LeaderboardOptions {
  minGames?: number;
  limit?: number;
}

/** One finished job's contribution to its decks' ratings, to add or take back. */
export interface RatingJobUpdate {
  jobId: string;
  /** The job's 4 deck ids, in seat order. */
  deckIds: string[];
  /** Every game the job played, resolved winner or not; counted per deck pair. */
  gameCount: number;
  /**
   * The decks' next ratings (same order as deckIds) given their stored
   * ones (null when never rated), or null to leave ratings unchanged; a
   * null entry leaves that deck's rating unchanged. Called inside the
   * store's transaction, so it must be pure.
   */
  update: (stored: (DeckRating | null)[]) => (DeckRating | null)[] | null;
}

export interface RatingStore {
  /** Get the current rating for a single deck. Returns null if never played. */
  getRating(deckId: string): Promise<DeckRating | null>;

  /**
   * Apply one job to its decks' ratings and pair game counts, atomically and
   * once per job (the job records that it was applied). Returns false when
   * the job was already applied or no longer exists.
   */
  applyJob(job: RatingJobUpdate): Promise<boolean>;

  /**
   * Take back a job that applyJob applied (it is being deleted): `update`
   * subtracts its games from the ratings, and its games come off the pair
   * counts, atomically, clearing the job's applied mark. Returns false when
   * the job was never applied or no longer exists.
   */
  removeJob(job: RatingJobUpdate): Promise<boolean>;

  /** Return ratings of decks with at least one rated game, sorted by conservative rating desc. */
  getLeaderboard(options?: LeaderboardOptions): Promise<DeckRating[]>;

  /** Games played per deck pair, keyed by pairKey(a, b). */
  getPairGameCounts(): Promise<Map<string, number>>;
}

/** Canonical key for a pair of deck IDs (alphabetically sorted). */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Each deck's pairs in a game: every other seat's deck. */
export function opponentsBySeat(deckIds: string[]): string[][] {
  return deckIds.map((id, i) => deckIds.filter((other, j) => j !== i && other !== id));
}

/**
 * Add `games` played together by the decks of one pod to per-deck pair
 * counts (deck id -> other deck id -> games); negative `games` takes them
 * back, and a pair left with none is dropped. Mutates and returns `counts`.
 */
export function addPodPairGames(
  counts: Map<string, Record<string, number>>,
  deckIds: string[],
  games = 1,
): Map<string, Record<string, number>> {
  opponentsBySeat(deckIds).forEach((opponents, i) => {
    const deckCounts = counts.get(deckIds[i]!) ?? {};
    for (const other of opponents) {
      const next = (deckCounts[other] ?? 0) + games;
      if (next > 0) deckCounts[other] = next;
      else delete deckCounts[other];
    }
    counts.set(deckIds[i]!, deckCounts);
  });
  return counts;
}
