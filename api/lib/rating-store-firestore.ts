/**
 * Firestore implementation of RatingStore (GCP mode).
 *
 * Collections:
 *   ratings/{deckId}       — DeckRating document
 *   matchResults/{id}      — MatchResult document
 */
import { Timestamp } from '@google-cloud/firestore';
import type { RatingStore, LeaderboardOptions } from './rating-store';
import type { DeckRating, MatchResult } from './types';
import { getFirestore } from './firestore-client';

const firestore = getFirestore();

const ratingsCol = firestore.collection('ratings');
const matchResultsCol = firestore.collection('matchResults');

function parseWinTurnHistogram(raw: unknown): number[] | undefined {
  if (!Array.isArray(raw) || raw.length !== 16) return undefined;
  if (!raw.every((n) => typeof n === 'number')) return undefined;
  return raw as number[];
}

function docToRating(deckId: string, d: FirebaseFirestore.DocumentData): DeckRating {
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

export const firestoreRatingStore: RatingStore = {
  async getRating(deckId: string): Promise<DeckRating | null> {
    const doc = await ratingsCol.doc(deckId).get();
    if (!doc.exists) return null;
    return docToRating(deckId, doc.data()!);
  },

  async updateRatings(updates: DeckRating[]): Promise<void> {
    const batch = firestore.batch();
    const now = Timestamp.now();
    for (const r of updates) {
      const doc: Record<string, unknown> = {
        mu: r.mu,
        sigma: r.sigma,
        gamesPlayed: r.gamesPlayed,
        wins: r.wins,
        lastUpdated: now,
      };
      if (r.deckName !== undefined) doc.deckName = r.deckName;
      if (r.setName !== undefined) doc.setName = r.setName;
      if (r.isPrecon !== undefined) doc.isPrecon = r.isPrecon;
      if (r.primaryCommander !== undefined) doc.primaryCommander = r.primaryCommander;
      if (r.winTurnSum !== undefined) doc.winTurnSum = r.winTurnSum;
      if (r.winTurnWins !== undefined) doc.winTurnWins = r.winTurnWins;
      if (r.winTurnHistogram !== undefined) doc.winTurnHistogram = r.winTurnHistogram;
      batch.set(ratingsCol.doc(r.deckId), doc);
    }
    await batch.commit();
  },

  async recordMatchResults(results: MatchResult[]): Promise<void> {
    if (results.length === 0) return;
    const now = Timestamp.now();
    // Firestore batches cap at 500 writes; chunk to stay under the limit.
    const CHUNK = 500;
    for (let i = 0; i < results.length; i += CHUNK) {
      const batch = firestore.batch();
      for (const r of results.slice(i, i + CHUNK)) {
        batch.set(matchResultsCol.doc(r.id), {
          jobId: r.jobId,
          gameIndex: r.gameIndex,
          deckIds: r.deckIds,
          winnerDeckId: r.winnerDeckId ?? null,
          turnCount: r.turnCount ?? null,
          playedAt: now,
        });
      }
      await batch.commit();
    }
  },

  async hasMatchResultsForJob(jobId: string): Promise<boolean> {
    const snapshot = await matchResultsCol.where('jobId', '==', jobId).limit(1).get();
    return !snapshot.empty;
  },

  async getLeaderboard(options?: LeaderboardOptions): Promise<DeckRating[]> {
    const minGames = options?.minGames ?? 0;
    const limit = options?.limit ?? 500;

    const snapshot = await ratingsCol
      .where('gamesPlayed', '>=', minGames)
      .orderBy('gamesPlayed', 'desc')
      .limit(limit)
      .get();

    const ratings: DeckRating[] = snapshot.docs.map((doc) => docToRating(doc.id, doc.data()));
    ratings.sort((a, b) => b.mu - 3 * b.sigma - (a.mu - 3 * a.sigma));
    return ratings;
  },
};
