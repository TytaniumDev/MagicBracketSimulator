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
 * Optimizations:
 *   - Reads denormalized deck metadata from rating docs (no N+1 getDeckById calls)
 *   - Falls back to getDeckById only for rating docs missing denormalized fields
 *   - 5-minute in-memory cache + Cache-Control headers
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, unauthorizedResponse } from '@/lib/auth';
import { getRatingStore } from '@/lib/rating-store-factory';
import { getDeckById } from '@/lib/deck-store-factory';
import { errorResponse } from '@/lib/api-response';

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

// In-memory cache with 5-minute TTL
let cache: { data: LeaderboardEntry[]; minGames: number; limit: number; at: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

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

    // Check cache
    const now = Date.now();
    if (cache && cache.minGames === minGames && cache.limit === limit && now - cache.at < CACHE_TTL_MS) {
      return NextResponse.json({ decks: cache.data }, {
        headers: { 'Cache-Control': 'public, max-age=300, s-maxage=300' },
      });
    }

    const store = getRatingStore();
    const ratings = await store.getLeaderboard({ minGames, limit });

    // Build leaderboard entries using denormalized metadata when available
    const entries = await Promise.all(
      ratings.map(async (r): Promise<LeaderboardEntry | null> => {
        // Use denormalized fields if present, otherwise fall back to getDeckById
        let name = r.deckName;
        let setName = r.setName;
        let isPrecon = r.isPrecon;
        let primaryCommander = r.primaryCommander;

        if (!name) {
          // Backcompat: older rating docs may not have denormalized metadata
          const deck = await getDeckById(r.deckId);
          if (!deck) return null;
          name = deck.name;
          setName = deck.setName ?? null;
          isPrecon = deck.isPrecon;
          primaryCommander = deck.primaryCommander ?? null;
        }

        return {
          deckId: r.deckId,
          name,
          setName: setName ?? null,
          isPrecon: isPrecon ?? false,
          primaryCommander: primaryCommander ?? null,
          mu: r.mu,
          sigma: r.sigma,
          rating: r.mu - 3 * r.sigma,
          gamesPlayed: r.gamesPlayed,
          wins: r.wins,
          winRate: r.gamesPlayed > 0 ? r.wins / r.gamesPlayed : 0,
        };
      }),
    );

    const validEntries = entries.filter((e): e is LeaderboardEntry => e !== null);

    // Update cache
    cache = { data: validEntries, minGames, limit, at: now };

    return NextResponse.json({ decks: validEntries }, {
      headers: { 'Cache-Control': 'public, max-age=300, s-maxage=300' },
    });
  } catch (error) {
    console.error('[Leaderboard] Failed to fetch leaderboard:', error);
    return errorResponse('Failed to fetch leaderboard', 500);
  }
}
