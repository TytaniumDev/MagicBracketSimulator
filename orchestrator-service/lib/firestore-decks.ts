/**
 * Firestore-backed unified deck store (precons + user decks).
 * Same schema for all decks; isPrecon and ownerId distinguish them.
 */
import { Firestore, Timestamp } from '@google-cloud/firestore';

const firestore = new Firestore({
  projectId: process.env.GOOGLE_CLOUD_PROJECT || 'magic-bracket-simulator',
});

const decksCollection = firestore.collection('decks');

export interface DeckDoc {
  id: string;
  name: string;
  filename: string;
  dck: string;
  primaryCommander?: string;
  colorIdentity?: string[];
  isPrecon: boolean;
  link?: string | null;
  ownerId: string | null;
  ownerEmail?: string | null;
  createdAt: FirebaseFirestore.Timestamp;
}

export interface DeckListItem {
  id: string;
  name: string;
  filename: string;
  primaryCommander?: string | null;
  colorIdentity?: string[];
  isPrecon: boolean;
  link?: string | null;
  ownerId: string | null;
  ownerEmail?: string | null;
  createdAt: string;
}

export interface CreateDeckInput {
  name: string;
  filename: string;
  dck: string;
  primaryCommander?: string;
  colorIdentity?: string[];
  isPrecon: boolean;
  link?: string | null;
  ownerId: string | null;
  ownerEmail?: string | null;
}

function docToDeck(doc: FirebaseFirestore.DocumentSnapshot): DeckDoc | null {
  if (!doc.exists) return null;
  const data = doc.data()!;
  return {
    id: doc.id,
    name: data.name,
    filename: data.filename,
    dck: data.dck,
    primaryCommander: data.primaryCommander,
    colorIdentity: data.colorIdentity,
    isPrecon: data.isPrecon === true,
    link: data.link ?? null,
    ownerId: data.ownerId ?? null,
    ownerEmail: data.ownerEmail ?? null,
    createdAt: data.createdAt,
  };
}

function deckToListItem(doc: DeckDoc): DeckListItem {
  return {
    id: doc.id,
    name: doc.name,
    filename: doc.filename,
    primaryCommander: doc.primaryCommander ?? null,
    colorIdentity: doc.colorIdentity,
    isPrecon: doc.isPrecon,
    link: doc.link,
    ownerId: doc.ownerId,
    ownerEmail: doc.ownerEmail,
    createdAt: doc.createdAt?.toDate?.()?.toISOString() ?? new Date().toISOString(),
  };
}

/**
 * List all decks (precons + every user's submissions)
 */
export async function listAllDecks(): Promise<DeckListItem[]> {
  const snapshot = await decksCollection.orderBy('isPrecon', 'desc').orderBy('name').get();
  const decks = snapshot.docs
    .map((doc) => docToDeck(doc))
    .filter((d): d is DeckDoc => d !== null);
  return decks.map(deckToListItem);
}

/**
 * Get a deck by ID (doc id)
 */
export async function getDeck(id: string): Promise<DeckDoc | null> {
  const doc = await decksCollection.doc(id).get();
  return docToDeck(doc);
}

/**
 * Read deck content for resolver (name, dck)
 */
export async function readDeckContent(id: string): Promise<{ name: string; dck: string } | null> {
  const deck = await getDeck(id);
  if (!deck) return null;
  return { name: deck.name, dck: deck.dck };
}

/**
 * Create a deck (user deck - precons are seeded)
 */
export async function createDeck(input: CreateDeckInput): Promise<DeckDoc> {
  const docRef = decksCollection.doc();
  const now = Timestamp.now();

  const doc: DeckDoc = {
    id: docRef.id,
    name: input.name,
    filename: input.filename,
    dck: input.dck,
    primaryCommander: input.primaryCommander,
    colorIdentity: input.colorIdentity,
    isPrecon: input.isPrecon,
    link: input.link ?? null,
    ownerId: input.ownerId,
    ownerEmail: input.ownerEmail ?? null,
    createdAt: now,
  };

  await docRef.set({
    id: docRef.id,
    name: input.name,
    filename: input.filename,
    dck: input.dck,
    primaryCommander: input.primaryCommander ?? null,
    colorIdentity: input.colorIdentity ?? null,
    isPrecon: input.isPrecon,
    link: input.link ?? null,
    ownerId: input.ownerId,
    ownerEmail: input.ownerEmail ?? null,
    createdAt: now,
  });

  return doc;
}

/**
 * Delete a deck. Only owner can delete. Precons (ownerId null) cannot be deleted.
 */
export async function deleteDeck(id: string, userId: string): Promise<boolean> {
  const deck = await getDeck(id);
  if (!deck) return false;
  if (deck.ownerId !== userId) {
    throw new Error('Only the deck owner can delete this deck');
  }

  await decksCollection.doc(id).delete();
  return true;
}
