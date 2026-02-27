import { NextRequest, NextResponse } from 'next/server';
import { verifyAllowedUser, unauthorizedResponse } from '@/lib/auth';
import { deleteDeck } from '@/lib/deck-store-factory';
import { removeColorIdentity } from '@/lib/deck-metadata';
import { errorResponse, notFoundResponse, badRequestResponse } from '@/lib/api-response';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * DELETE /api/decks/[id] - Delete a deck (only owner can delete)
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  let user;
  try {
    user = await verifyAllowedUser(request);
  } catch {
    return unauthorizedResponse();
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
