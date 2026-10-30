/**
 * Firestore implementation of DataWipeStore (GCP mode). Deletes go out as
 * one batched write per call so a wipe stays inside the free tier's limits.
 */
import type { DataWipeStore, LeftoverKind } from './data-wipe-store';
import { getFirestore } from './firestore-client';
import { deckStatsOfKind } from './deck-stats-refs';

const firestore = getFirestore();

/** The query whose results are leftovers of each kind. */
function leftoversQuery(kind: Exclude<LeftoverKind, 'customDecks'>): FirebaseFirestore.Query {
  // Simulations live in a subcollection per job, and survive their parent
  // job doc if it was deleted first, so they're found across all jobs.
  if (kind === 'simulations') return firestore.collectionGroup('simulations');
  // Deck stats live under each deck (see deck-stats-refs.ts); precons keep
  // their deck doc but lose its stats.
  if (kind === 'ratings') return deckStatsOfKind('rating');
  if (kind === 'cardStats') return deckStatsOfKind('cards');
  return firestore.collection(kind);
}

async function leftoverRefs(kind: LeftoverKind, limit: number): Promise<FirebaseFirestore.DocumentReference[]> {
  if (kind === 'customDecks') {
    // Filter in code rather than with `isPrecon == false`, which would miss
    // decks saved without the field.
    const snapshot = await firestore.collection('decks').select('isPrecon').get();
    return snapshot.docs.filter((doc) => doc.get('isPrecon') !== true).slice(0, limit).map((doc) => doc.ref);
  }
  const snapshot = await leftoversQuery(kind).select().limit(limit).get();
  return snapshot.docs.map((doc) => doc.ref);
}

export const firestoreDataWipeStore: DataWipeStore = {
  async listJobIds(limit) {
    // No orderBy: ordering by createdAt would skip job docs without one.
    const snapshot = await firestore.collection('jobs').select().limit(limit).get();
    return snapshot.docs.map((doc) => doc.id);
  },

  async deleteLeftovers(kind, limit) {
    const refs = await leftoverRefs(kind, Math.min(limit, 500));
    if (refs.length === 0) return 0;
    const batch = firestore.batch();
    for (const ref of refs) batch.delete(ref);
    await batch.commit();
    return refs.length;
  },
};
