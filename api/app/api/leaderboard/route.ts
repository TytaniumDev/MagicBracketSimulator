/**
 * GET /api/leaderboard
 *
 * Returns Bayesian-adjusted win-rate rankings for all decks, enriched with
 * deck metadata.
 *
 * Query parameters:
 *   minGames  — minimum games_played to include (default: 0)
 *   limit     — max results to return (default: 500)
 *
 * Response:
 *   { decks: LeaderboardEntry[] }
 *
 * Implementation notes:
 *   - The rating store's internal sort/limit is irrelevant here: we fetch all
 *     matching ratings, re-score with the Bayesian formula, then sort/slice
 *     in the route so top-N reflects the new ranking system.
 *   - Reads denormalized deck metadata from rating docs (no N+1 getDeckById calls).
 *   - Falls back to getDeckById only for rating docs missing denormalized fields.
 *   - 5-minute in-memory cache + Cache-Control headers.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAllowedUser, unauthorizedResponse } from '@/lib/auth';
import { getRatingStore } from '@/lib/rating-store-factory';
import { getDeckById } from '@/lib/deck-store-factory';
import { errorResponse } from '@/lib/api-response';
import { toDeckStats } from '@/lib/deck-stats';
import type { DeckStats } from '@shared/types/deck';
import * as Sentry from '@sentry/nextjs';

export interface LeaderboardEntry extends DeckStats {
  deckId: string;
  name: string;
  setName: string | null;
  isPrecon: boolean;
  primaryCommander: string | null;
  /** @deprecated Legacy TrueSkill mean; no longer updated. Neutral default (25) for new decks. */
  mu: number;
  /** @deprecated Legacy TrueSkill uncertainty; no longer updated. Neutral default (≈8.33) for new decks. */
  sigma: number;
}

// Upper bound when fetching from the store — anything above this means we have
// bigger problems than leaderboard truncation. The route applies the user's
// `limit` itself after Bayesian scoring so the store's internal sort order
// cannot silently drop high-Bayesian decks.
const STORE_FETCH_CAP = 10_000;

// In-memory cache with 5-minute TTL
let cache: { data: LeaderboardEntry[]; minGames: number; limit: number; at: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function GET(request: NextRequest) {
  try {
    await verifyAllowedUser(request);
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
    // Fetch without honoring the user's limit at the store layer: the store's
    // internal sort order is legacy and may not match the Bayesian ranking we
    // present here. Sort/slice ourselves below.
    const ratings = await store.getLeaderboard({ minGames, limit: STORE_FETCH_CAP });

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
          ...toDeckStats(r),
        };
      }),
    );

    const validEntries = entries
      .filter((e): e is LeaderboardEntry => e !== null)
      .sort((a, b) => b.rating - a.rating)
      .slice(0, limit);

    // Update cache
    cache = { data: validEntries, minGames, limit, at: now };

    return NextResponse.json({ decks: validEntries }, {
      headers: { 'Cache-Control': 'public, max-age=300, s-maxage=300' },
    });
  } catch (error) {
    console.error('[Leaderboard] Failed to fetch leaderboard:', error);
    Sentry.captureException(error, { tags: { component: 'api-route', route: 'GET /api/leaderboard' } });
    return errorResponse('Failed to fetch leaderboard', 500);
  }
}
