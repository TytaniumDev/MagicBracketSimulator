/**
 * Rating store interface — persists TrueSkill ratings and match results.
 * Implemented by rating-store-sqlite.ts (LOCAL) and rating-store-firestore.ts (GCP).
 */
import type { DeckRating, MatchResult } from './types';

export type { DeckRating, MatchResult };

export interface LeaderboardOptions {
  minGames?: number;
  limit?: number;
}

export interface RatingStore {
  /** Get the current rating for a single deck. Returns null if never played. */
  getRating(deckId: string): Promise<DeckRating | null>;

  /** Upsert ratings for multiple decks in one operation. */
  updateRatings(updates: DeckRating[]): Promise<void>;

  /** Record a match result (for idempotency checks). */
  recordMatchResult(result: MatchResult): Promise<void>;

  /** Return true if match results already exist for this jobId. */
  hasMatchResultsForJob(jobId: string): Promise<boolean>;

  /** Return all ratings, optionally filtered, sorted by conservative rating desc. */
  getLeaderboard(options?: LeaderboardOptions): Promise<DeckRating[]>;
}
