/**
 * Firestore implementation of CardStatsStore (GCP mode).
 *
 * One DeckCardStats doc per deck at decks/{deckId}/stats/cards (see
 * deck-stats-refs.ts), so a finished job costs one read and one write per
 * deck.
 */
import { applyJobUpdates, removeJobUpdate, type CardStatsStore } from './card-stats-store';
import { currentDeckCardStats, emptyDeckCardStats } from './card-impact/stats';
import type { DeckCardStats } from '@shared/types/card-impact';
import { getFirestore } from './firestore-client';
import { deckStatsRef } from './deck-stats-refs';

const firestore = getFirestore();

export const firestoreCardStatsStore: CardStatsStore = {
  async get(deckId: string): Promise<DeckCardStats | null> {
    const snap = await deckStatsRef(deckId, 'cards').get();
    return currentDeckCardStats(snap.exists ? (snap.data() as DeckCardStats) : null);
  },

  async addJobs(deckId, jobs): Promise<number> {
    const ref = deckStatsRef(deckId, 'cards');
    return firestore.runTransaction(async (transaction) => {
      const snap = await transaction.get(ref);
      const current = currentDeckCardStats(snap.exists ? (snap.data() as DeckCardStats) : null) ?? emptyDeckCardStats();
      const { next, applied } = applyJobUpdates(current, jobs);
      if (applied > 0) transaction.set(ref, { ...next, kind: 'cards' });
      return applied;
    });
  },

  async removeJob(deckId, job): Promise<boolean> {
    const ref = deckStatsRef(deckId, 'cards');
    return firestore.runTransaction(async (transaction) => {
      const snap = await transaction.get(ref);
      const next = removeJobUpdate(currentDeckCardStats(snap.exists ? (snap.data() as DeckCardStats) : null), job);
      if (next) transaction.set(ref, { ...next, kind: 'cards' });
      return next !== null;
    });
  },
};
