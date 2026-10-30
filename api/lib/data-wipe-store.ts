/**
 * Data wipe store — finds and deletes the records an admin data wipe
 * removes: every job and what was derived from jobs, plus user-imported
 * decks. Precons, workers, allowed users and config are kept.
 * Implemented by data-wipe-store-sqlite.ts (LOCAL) and
 * data-wipe-store-firestore.ts (GCP).
 */

/** Records left once every job is gone, in the order the wipe clears them. */
export const LEFTOVER_KINDS = [
  'simulations',
  'podRuns',
  'ratings',
  'deckSummaries',
  'cardStats',
  'idempotencyKeys',
  'customDecks',
] as const;

export type LeftoverKind = (typeof LEFTOVER_KINDS)[number];

export type WipeKind = 'jobs' | LeftoverKind;

export interface DataWipeStore {
  /** Up to `limit` job ids, in no particular order. */
  listJobIds(limit: number): Promise<string[]>;

  /**
   * Delete up to `limit` records of one kind in one batch, for records that
   * outlive their jobs (e.g. simulations under an already deleted job). For
   * `deckSummaries` that means clearing the summary on precon deck docs.
   * Returns how many were deleted; 0 means none are left.
   */
  deleteLeftovers(kind: LeftoverKind, limit: number): Promise<number>;
}
