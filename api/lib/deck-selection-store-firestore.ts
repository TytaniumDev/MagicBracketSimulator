/**
 * Firestore implementation of DeckSelectionStore (GCP mode).
 * All exclusions live in one doc so reading them costs a single read.
 */
import { FieldValue } from '@google-cloud/firestore';
import type { DeckSelectionStore } from './deck-selection-store';
import { getFirestore } from './firestore-client';

const firestore = getFirestore();

const configDoc = firestore.collection('config').doc('deckSelection');

export const firestoreDeckSelectionStore: DeckSelectionStore = {
  async getExcludedDeckIds(): Promise<string[]> {
    const doc = await configDoc.get();
    const ids = doc.exists ? doc.data()!.excludedDeckIds : null;
    return Array.isArray(ids) ? ids : [];
  },

  async setDeckExcluded(deckId, excluded, updatedBy): Promise<string[]> {
    await configDoc.set(
      {
        excludedDeckIds: excluded ? FieldValue.arrayUnion(deckId) : FieldValue.arrayRemove(deckId),
        updatedAt: new Date().toISOString(),
        updatedBy,
      },
      { merge: true },
    );
    return this.getExcludedDeckIds();
  },
};
