import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, unauthorizedResponse } from '@/lib/auth';
import { getCardStatsStore } from '@/lib/card-stats-store-factory';
import { scoreCards } from '@/lib/card-impact/stats';
import { errorResponse, badRequestResponse } from '@/lib/api-response';
import type { DeckCardImpactResponse } from '@shared/types/card-impact';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/decks/[id]/card-impact - Per-card impact scores for the deck page,
 * computed from the deck's stored counters (one document read).
 * Returns zero games and no cards when the deck has no counted jobs yet.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    await verifyAuth(request);
  } catch {
    return unauthorizedResponse();
  }

  try {
    const { id } = await params;

    if (!id) {
      return badRequestResponse('Deck ID is required');
    }

    const stats = await getCardStatsStore().get(id);
    const body: DeckCardImpactResponse = stats
      ? { games: stats.games, cards: scoreCards(stats) }
      : { games: 0, cards: [] };

    return NextResponse.json(body);
  } catch (error) {
    console.error('Failed to get card impact:', error);
    return errorResponse('Failed to get card impact', 500);
  }
}
