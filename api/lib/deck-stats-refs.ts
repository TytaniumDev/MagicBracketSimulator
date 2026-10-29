/**
 * Where per-deck stats live in Firestore (GCP mode).
 *
 * Each deck keeps one doc per kind of stats under it:
 *   decks/{deckId}/stats/rating — win stats, win turns and pairGames
 *   decks/{deckId}/stats/cards  — card impact counters
 *
 * Every doc carries `kind` so one collection-group query can read a kind
 * across all decks (the leaderboard, pair coverage, data wipe).
 */
import { getFirestore } from './firestore-client';

export type DeckStatsKind = 'rating' | 'cards';

export function deckStatsRef(deckId: string, kind: DeckStatsKind): FirebaseFirestore.DocumentReference {
  return getFirestore().collection('decks').doc(deckId).collection('stats').doc(kind);
}

/** Every deck's stats doc of one kind. */
export function deckStatsOfKind(kind: DeckStatsKind): FirebaseFirestore.Query {
  return getFirestore().collectionGroup('stats').where('kind', '==', kind);
}

/** The deck a stats doc belongs to. */
export function deckIdOfStats(ref: FirebaseFirestore.DocumentReference): string {
  return ref.parent.parent!.id;
}
