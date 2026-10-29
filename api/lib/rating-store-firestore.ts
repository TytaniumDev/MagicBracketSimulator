/**
 * Firestore implementation of RatingStore (GCP mode).
 *
 * One doc per deck at decks/{deckId}/stats/rating (see deck-stats-refs.ts)
 * holding its DeckRating fields plus `pairGames`, a map of other deck id to
 * games played together, which pair coverage reads instead of one doc per
 * game. A job is applied once: its doc records `appliedStats.ratings`.
 */
import { Timestamp } from '@google-cloud/firestore';
import { addPodPairGames, pairKey, type RatingStore, type LeaderboardOptions } from './rating-store';
import type { DeckRating } from './types';
import { getFirestore } from './firestore-client';
import { deckIdOfStats, deckStatsOfKind, deckStatsRef } from './deck-stats-refs';
import { ensureLegacyDeckStatsMigrated } from './legacy-deck-stats-migration';

const firestore = getFirestore();

function parseWinTurnHistogram(raw: unknown): number[] | undefined {
  if (!Array.isArray(raw) || raw.length !== 16) return undefined;
  if (!raw.every((n) => typeof n === 'number')) return undefined;
  return raw as number[];
}

/** Read a stored rating doc (current or legacy `ratings/{deckId}` shape). */
export function docToRating(deckId: string, d: FirebaseFirestore.DocumentData): DeckRating {
  const rating: DeckRating = {
    deckId,
    mu: d.mu as number,
    sigma: d.sigma as number,
    gamesPlayed: d.gamesPlayed as number,
    wins: d.wins as number,
    lastUpdated: (d.lastUpdated as Timestamp).toDate().toISOString(),
  };
  if (d.deckName) rating.deckName = d.deckName as string;
  if (d.setName !== undefined) rating.setName = d.setName as string | null;
  if (d.isPrecon !== undefined) rating.isPrecon = d.isPrecon as boolean;
  if (d.primaryCommander !== undefined) rating.primaryCommander = d.primaryCommander as string | null;
  if (typeof d.winTurnSum === 'number') rating.winTurnSum = d.winTurnSum;
  if (typeof d.winTurnWins === 'number') rating.winTurnWins = d.winTurnWins;
  const hist = parseWinTurnHistogram(d.winTurnHistogram);
  if (hist) rating.winTurnHistogram = hist;
  return rating;
}

/** The stored fields of a rating, without deckId (the doc's path holds it). */
export function ratingToDoc(r: DeckRating): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    kind: 'rating',
    mu: r.mu,
    sigma: r.sigma,
    gamesPlayed: r.gamesPlayed,
    wins: r.wins,
    lastUpdated: Timestamp.fromDate(new Date(r.lastUpdated)),
  };
  if (r.deckName !== undefined) doc.deckName = r.deckName;
  if (r.setName !== undefined) doc.setName = r.setName;
  if (r.isPrecon !== undefined) doc.isPrecon = r.isPrecon;
  if (r.primaryCommander !== undefined) doc.primaryCommander = r.primaryCommander;
  if (r.winTurnSum !== undefined) doc.winTurnSum = r.winTurnSum;
  if (r.winTurnWins !== undefined) doc.winTurnWins = r.winTurnWins;
  if (r.winTurnHistogram !== undefined) doc.winTurnHistogram = r.winTurnHistogram;
  return doc;
}

export const firestoreRatingStore: RatingStore = {
  async getRating(deckId: string): Promise<DeckRating | null> {
    await ensureLegacyDeckStatsMigrated();
    const doc = await deckStatsRef(deckId, 'rating').get();
    if (!doc.exists || !(doc.get('gamesPlayed') > 0)) return null;
    return docToRating(deckId, doc.data()!);
  },

  async applyJob({ jobId, deckIds, gameCount, update }): Promise<boolean> {
    await ensureLegacyDeckStatsMigrated();
    const jobRef = firestore.collection('jobs').doc(jobId);
    const refs = deckIds.map((id) => deckStatsRef(id, 'rating'));

    return firestore.runTransaction(async (tx) => {
      const [jobSnap, ...snaps] = await tx.getAll(jobRef, ...refs);
      if (!jobSnap.exists || jobSnap.get('appliedStats.ratings') === true) return false;

      const stored = snaps.map((s, i) =>
        s.exists && s.get('gamesPlayed') > 0 ? docToRating(deckIds[i]!, s.data()!) : null,
      );
      const next = update(stored);
      const pairCounts = addPodPairGames(
        new Map(deckIds.map((id, i) => [id, { ...(snaps[i]!.get('pairGames') ?? {}) }])),
        deckIds,
        gameCount,
      );

      refs.forEach((ref, i) => {
        const pairGames = pairCounts.get(deckIds[i]!);
        const rating = next?.[i];
        tx.set(ref, rating ? { ...ratingToDoc(rating), pairGames } : { kind: 'rating', pairGames }, { merge: true });
      });
      tx.update(jobRef, { 'appliedStats.ratings': true });
      return true;
    });
  },

  async getLeaderboard(options?: LeaderboardOptions): Promise<DeckRating[]> {
    await ensureLegacyDeckStatsMigrated();
    const minGames = Math.max(options?.minGames ?? 0, 1);
    const limit = options?.limit ?? 500;

    const snapshot = await deckStatsOfKind('rating')
      .where('gamesPlayed', '>=', minGames)
      .orderBy('gamesPlayed', 'desc')
      .limit(limit)
      .get();

    const ratings = snapshot.docs.map((doc) => docToRating(deckIdOfStats(doc.ref), doc.data()));
    ratings.sort((a, b) => b.mu - 3 * b.sigma - (a.mu - 3 * a.sigma));
    return ratings;
  },

  async getPairGameCounts(): Promise<Map<string, number>> {
    await ensureLegacyDeckStatsMigrated();
    const snapshot = await deckStatsOfKind('rating').select('pairGames').get();
    const counts = new Map<string, number>();
    for (const doc of snapshot.docs) {
      const deckId = deckIdOfStats(doc.ref);
      const pairGames = (doc.get('pairGames') as Record<string, number> | undefined) ?? {};
      // Both decks of a pair hold the same count; read it from the first.
      for (const [other, games] of Object.entries(pairGames)) {
        if (deckId < other) counts.set(pairKey(deckId, other), games);
      }
    }
    return counts;
  },
};
