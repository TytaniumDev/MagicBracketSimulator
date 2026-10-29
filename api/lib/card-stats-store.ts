/**
 * Card stats store — persists one DeckCardStats document per deck.
 * Implemented by card-stats-store-sqlite.ts (LOCAL) and
 * card-stats-store-firestore.ts (GCP).
 */
import type { DeckCardStats } from '@shared/types/card-impact';

export type { DeckCardStats };

export interface CardStatsStore {
  /** The deck's counters, or null if none of its jobs have been counted. */
  get(deckId: string): Promise<DeckCardStats | null>;

  /**
   * Atomically apply `update` to the deck's counters and record `jobId`,
   * unless that job was already counted. Returns true when applied.
   */
  addJob(
    deckId: string,
    jobId: string,
    update: (stats: DeckCardStats) => DeckCardStats,
  ): Promise<boolean>;
}
