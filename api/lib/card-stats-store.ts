/**
 * Card stats store — persists one DeckCardStats document per deck.
 * Implemented by card-stats-store-sqlite.ts (LOCAL) and
 * card-stats-store-firestore.ts (GCP).
 */
import type { DeckCardStats } from '@shared/types/card-impact';

export type { DeckCardStats };

/** One job's contribution to a deck's counters. */
export interface CardStatsJobUpdate {
  jobId: string;
  update: (stats: DeckCardStats) => DeckCardStats;
}

export interface CardStatsStore {
  /** The deck's counters, or null if none of its jobs have been counted. */
  get(deckId: string): Promise<DeckCardStats | null>;

  /**
   * Atomically apply each job's update to the deck's counters and record
   * its job id, skipping jobs already counted. One read and one write per
   * call however many jobs it carries. Returns how many jobs were applied.
   */
  addJobs(deckId: string, jobs: CardStatsJobUpdate[]): Promise<number>;
}

/** Apply the jobs `current` hasn't counted yet, in order. Shared by both stores. */
export function applyJobUpdates(
  current: DeckCardStats,
  jobs: CardStatsJobUpdate[],
): { next: DeckCardStats; applied: number } {
  const counted = new Set(current.jobIds);
  let next = current;
  let applied = 0;
  for (const { jobId, update } of jobs) {
    if (counted.has(jobId)) continue;
    counted.add(jobId);
    next = { ...update(next), jobIds: [...counted] };
    applied++;
  }
  return { next, applied };
}
