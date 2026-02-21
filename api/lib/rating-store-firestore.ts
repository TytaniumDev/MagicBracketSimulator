/**
 * Firestore implementation of RatingStore (GCP mode).
 *
 * Collections:
 *   ratings/{deckId}       — DeckRating document
 *   matchResults/{id}      — MatchResult document
 */
import { Firestore, Timestamp } from '@google-cloud/firestore';
import type { RatingStore, LeaderboardOptions } from './rating-store';
import type { DeckRating, MatchResult } from './types';

const firestore = new Firestore({
  projectId: process.env.GOOGLE_CLOUD_PROJECT || 'magic-bracket-simulator',
});

const ratingsCol = firestore.collection('ratings');
const matchResultsCol = firestore.collection('matchResults');

export const firestoreRatingStore: RatingStore = {
  async getRating(deckId: string): Promise<DeckRating | null> {
    const doc = await ratingsCol.doc(deckId).get();
    if (!doc.exists) return null;
    const d = doc.data()!;
    return {
      deckId,
      mu: d.mu as number,
      sigma: d.sigma as number,
      gamesPlayed: d.gamesPlayed as number,
      wins: d.wins as number,
      lastUpdated: (d.lastUpdated as Timestamp).toDate().toISOString(),
    };
  },

  async updateRatings(updates: DeckRating[]): Promise<void> {
    const batch = firestore.batch();
    const now = Timestamp.now();
    for (const r of updates) {
      batch.set(ratingsCol.doc(r.deckId), {
        mu: r.mu,
        sigma: r.sigma,
        gamesPlayed: r.gamesPlayed,
        wins: r.wins,
        lastUpdated: now,
      });
    }
    await batch.commit();
  },

  async recordMatchResult(result: MatchResult): Promise<void> {
    await matchResultsCol.doc(result.id).set({
      jobId: result.jobId,
      gameIndex: result.gameIndex,
      deckIds: result.deckIds,
      winnerDeckId: result.winnerDeckId ?? null,
      turnCount: result.turnCount ?? null,
      playedAt: Timestamp.now(),
    });
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
      .limit(limit)
      .get();

    const ratings: DeckRating[] = snapshot.docs.map((doc) => {
      const d = doc.data();
      return {
        deckId: doc.id,
        mu: d.mu as number,
        sigma: d.sigma as number,
        gamesPlayed: d.gamesPlayed as number,
        wins: d.wins as number,
        lastUpdated: (d.lastUpdated as Timestamp).toDate().toISOString(),
      };
    });

    // Sort by conservative rating (mu - 3*sigma) descending
    ratings.sort((a, b) => b.mu - 3 * b.sigma - (a.mu - 3 * a.sigma));
    return ratings;
  },
};
