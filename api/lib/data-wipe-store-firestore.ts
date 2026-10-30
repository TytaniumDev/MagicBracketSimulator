/**
 * Firestore implementation of DataWipeStore (GCP mode). Deletes go through a
 * BulkWriter, not one batched write: a batch fails as "transaction too big"
 * when its docs carry many index entries, as cardStats docs do (one map
 * entry per card).
 */
import { FieldValue } from '@google-cloud/firestore';
import type { DataWipeStore, LeftoverKind } from './data-wipe-store';
import { getFirestore } from './firestore-client';
import { deckStatsOfKind } from './deck-stats-refs';

const firestore = getFirestore();

/** The query whose results are leftovers of each kind. */
function leftoversQuery(kind: Exclude<LeftoverKind, 'customDecks' | 'deckSummaries'>): FirebaseFirestore.Query {
  // Simulations live in a subcollection per job, and survive their parent
  // job doc if it was deleted first, so they're found across all jobs.
  if (kind === 'simulations') return firestore.collectionGroup('simulations');
  // Deck stats live under each deck (see deck-stats-refs.ts); precons keep
  // their deck doc but lose its stats.
  if (kind === 'ratings') return deckStatsOfKind('rating');
  if (kind === 'cardStats') return deckStatsOfKind('cards');
  return firestore.collection(kind);
}

/**
 * Top-level collections from before deck stats moved under each deck. Nothing
 * reads them any more, but a wipe still clears them with their kind.
 */
const LEGACY_COLLECTIONS: Partial<Record<LeftoverKind, string[]>> = {
  ratings: ['ratings', 'matchResults'],
  cardStats: ['cardStats'],
};

async function leftoverRefs(kind: Exclude<LeftoverKind, 'deckSummaries'>, limit: number): Promise<FirebaseFirestore.DocumentReference[]> {
  if (kind === 'customDecks') {
    // Filter in code rather than with `isPrecon == false`, which would miss
    // decks saved without the field.
    const snapshot = await firestore.collection('decks').select('isPrecon').get();
    return snapshot.docs.filter((doc) => doc.get('isPrecon') !== true).slice(0, limit).map((doc) => doc.ref);
  }
  const queries = [leftoversQuery(kind), ...(LEGACY_COLLECTIONS[kind] ?? []).map((name) => firestore.collection(name))];
  const refs: FirebaseFirestore.DocumentReference[] = [];
  for (const query of queries) {
    if (refs.length >= limit) break;
    const snapshot = await query.select().limit(limit - refs.length).get();
    refs.push(...snapshot.docs.map((doc) => doc.ref));
  }
  return refs;
}

/** Clear the win stats copied onto deck docs (see DeckSummary). */
async function clearDeckSummaries(limit: number): Promise<number> {
  const snapshot = await firestore.collection('decks').where('summary.gamesPlayed', '>', 0).select().limit(limit).get();
  if (snapshot.empty) return 0;
  const writer = firestore.bulkWriter();
  const updates = Promise.all(snapshot.docs.map((doc) => writer.update(doc.ref, { summary: FieldValue.delete() })));
  await writer.close();
  await updates;
  return snapshot.size;
}

export const firestoreDataWipeStore: DataWipeStore = {
  async listJobIds(limit) {
    // No orderBy: ordering by createdAt would skip job docs without one.
    const snapshot = await firestore.collection('jobs').select().limit(limit).get();
    return snapshot.docs.map((doc) => doc.id);
  },

  async deleteLeftovers(kind, limit) {
    if (kind === 'deckSummaries') return clearDeckSummaries(limit);
    const refs = await leftoverRefs(kind, limit);
    if (refs.length === 0) return 0;
    const writer = firestore.bulkWriter();
    // Attach to every delete now so a failed one surfaces here, not as an unhandled rejection.
    const deletes = Promise.all(refs.map((ref) => writer.delete(ref)));
    await writer.close();
    await deletes;
    return refs.length;
  },
};
