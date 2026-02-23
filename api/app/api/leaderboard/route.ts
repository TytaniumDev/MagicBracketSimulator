/**
 * GET /api/leaderboard
 *
 * Returns TrueSkill ratings for all decks, enriched with deck metadata.
 *
 * Query parameters:
 *   minGames  — minimum games_played to include (default: 0)
 *   limit     — max results to return (default: 500)
 *
 * Response:
 *   { decks: LeaderboardEntry[] }
 *
 * LeaderboardEntry includes deckId, name, setName, isPrecon, mu, sigma,
 * rating (mu - 3*sigma), gamesPlayed, wins, winRate.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, unauthorizedResponse } from '@/lib/auth';
import { getRatingStore } from '@/lib/rating-store-factory';
import { getDeckById } from '@/lib/deck-store-factory';

export interface LeaderboardEntry {
  deckId: string;
  name: string;
  setName: string | null;
  isPrecon: boolean;
  primaryCommander: string | null;
  mu: number;
  sigma: number;
  /** Conservative rating: mu - 3*sigma (display value) */
  rating: number;
  gamesPlayed: number;
  wins: number;
  winRate: number;
}

export async function GET(request: NextRequest) {
  try {
    await verifyAuth(request);
  } catch {
    return unauthorizedResponse();
  }

  try {
    const { searchParams } = new URL(request.url);
    const minGames = parseInt(searchParams.get('minGames') ?? '0', 10) || 0;
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '500', 10) || 500, 1000);

    const store = getRatingStore();
    const ratings = await store.getLeaderboard({ minGames, limit });

    // Enrich with deck metadata in parallel
    const entries = await Promise.all(
      ratings.map(async (r): Promise<LeaderboardEntry | null> => {
        const deck = await getDeckById(r.deckId);
        if (!deck) return null;
        return {
          deckId: r.deckId,
          name: deck.name,
          setName: deck.setName ?? null,
          isPrecon: deck.isPrecon,
          primaryCommander: deck.primaryCommander ?? null,
          mu: r.mu,
          sigma: r.sigma,
          rating: r.mu - 3 * r.sigma,
          gamesPlayed: r.gamesPlayed,
          wins: r.wins,
          winRate: r.gamesPlayed > 0 ? r.wins / r.gamesPlayed : 0,
        };
      }),
    );

    // Filter out decks that no longer exist in the store
    const validEntries = entries.filter((e): e is LeaderboardEntry => e !== null);

    return NextResponse.json({ decks: validEntries });
  } catch (error) {
    console.error('[Leaderboard] Failed to fetch leaderboard:', error);
    return NextResponse.json({ error: 'Failed to fetch leaderboard' }, { status: 500 });
  }
}
