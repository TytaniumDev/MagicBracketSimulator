/**
 * Firestore implementation of DeckSelectionStore (GCP mode).
 * An excluded deck carries `excluded: true` on its own doc, so deleting a
 * deck drops its exclusion with it.
 */
import { FieldValue } from '@google-cloud/firestore';
import type { DeckSelectionStore } from './deck-selection-store';
import { getFirestore } from './firestore-client';

const decksCollection = getFirestore().collection('decks');

export const firestoreDeckSelectionStore: DeckSelectionStore = {
  async getExcludedDeckIds(): Promise<string[]> {
    const snapshot = await decksCollection.where('excluded', '==', true).select().get();
    return snapshot.docs.map((doc) => doc.id).sort();
  },

  // Who excluded the deck isn't recorded here: deck docs are readable by
  // the web app, and the admin's email shouldn't be.
  async setDeckExcluded(deckId, excluded): Promise<string[]> {
    await decksCollection.doc(deckId).update({ excluded: excluded ? true : FieldValue.delete() });
    return this.getExcludedDeckIds();
  },
};
