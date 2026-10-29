import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyAllowedUser, unauthorizedResponse, AuthUser } from '@/lib/auth';
import { deleteDeck, getDeckById, readDeckContent } from '@/lib/deck-store-factory';
import { removeColorIdentity } from '@/lib/deck-metadata';
import { getRatingStore } from '@/lib/rating-store-factory';
import { parseDckCards } from '@/lib/dck-cards';
import { toDeckStats } from '@/lib/deck-stats';
import { errorResponse, notFoundResponse, badRequestResponse } from '@/lib/api-response';
import type { DeckDetailResponse } from '@shared/types/deck';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/decks/[id] - Deck page data: metadata, parsed decklist, and the
 * deck's results across every recorded game (null stats if it never played).
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

    const [deck, content, rating] = await Promise.all([
      getDeckById(id),
      readDeckContent(id),
      getRatingStore().getRating(id),
    ]);

    if (!deck || !content) {
      return notFoundResponse('Deck');
    }

    const { commanders, main } = parseDckCards(content.dck);
    const body: DeckDetailResponse = {
      deck: {
        id: deck.id,
        name: deck.name,
        primaryCommander: deck.primaryCommander ?? null,
        colorIdentity: deck.colorIdentity ?? [],
        isPrecon: deck.isPrecon,
        setName: deck.setName ?? null,
        link: deck.link ?? null,
      },
      commanders,
      cards: main,
      stats: rating && rating.gamesPlayed > 0 ? toDeckStats(rating) : null,
    };

    return NextResponse.json(body);
  } catch (error) {
    console.error('Failed to get deck:', error);
    return errorResponse('Failed to get deck', 500);
  }
}

/**
 * DELETE /api/decks/[id] - Delete a deck (only owner can delete)
 */
export async function DELETE(request: NextRequest, { params }: RouteParams): Promise<NextResponse | Response> {
  let user: AuthUser;
  try {
    user = await verifyAllowedUser(request);
  } catch (error) {
    return unauthorizedResponse(error instanceof Error ? error.message : undefined);
  }

  try {
    const { id } = await params;

    if (!id) {
      return badRequestResponse('Deck ID is required');
    }

    const deleted = await deleteDeck(id, user.uid);

    if (deleted) {
      removeColorIdentity(id);
    }

    if (!deleted) {
      return notFoundResponse('Deck');
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('Failed to delete deck:', error);
    const message = error instanceof Error ? error.message : 'Failed to delete deck';

    if (message.includes('Only the deck owner')) {
      return errorResponse(message, 403);
    }

    return errorResponse(message, 500);
  }
}
