/**
 * Firestore implementation of CardStatsStore (GCP mode).
 *
 * Collection:
 *   cardStats/{deckId} — DeckCardStats document (one per deck, so a finished
 *   job costs one read and one write per deck).
 */
import { applyJobUpdates, type CardStatsStore } from './card-stats-store';
import { currentDeckCardStats, emptyDeckCardStats } from './card-impact/stats';
import type { DeckCardStats } from '@shared/types/card-impact';
import { getFirestore } from './firestore-client';

const firestore = getFirestore();
const cardStatsCol = firestore.collection('cardStats');

export const firestoreCardStatsStore: CardStatsStore = {
  async get(deckId: string): Promise<DeckCardStats | null> {
    const snap = await cardStatsCol.doc(deckId).get();
    return currentDeckCardStats(snap.exists ? (snap.data() as DeckCardStats) : null);
  },

  async addJobs(deckId, jobs): Promise<number> {
    const ref = cardStatsCol.doc(deckId);
    return firestore.runTransaction(async (transaction) => {
      const snap = await transaction.get(ref);
      const current = currentDeckCardStats(snap.exists ? (snap.data() as DeckCardStats) : null) ?? emptyDeckCardStats();
      const { next, applied } = applyJobUpdates(current, jobs);
      if (applied > 0) transaction.set(ref, next);
      return applied;
    });
  },
};
