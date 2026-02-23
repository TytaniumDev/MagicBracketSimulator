import { NextRequest, NextResponse } from 'next/server';
import { verifyAllowedUser, unauthorizedResponse } from '@/lib/auth';
import { deleteDeck } from '@/lib/deck-store-factory';
import { removeColorIdentity } from '@/lib/deck-metadata';

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
      return NextResponse.json(
        { error: 'Deck ID is required' },
        { status: 400 }
      );
    }

    const deleted = await deleteDeck(id, user.uid);

    if (deleted) {
      removeColorIdentity(id);
    }

    if (!deleted) {
      return NextResponse.json(
        { error: 'Deck not found or you do not have permission to delete it' },
        { status: 404 }
      );
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('Failed to delete deck:', error);
    const message = error instanceof Error ? error.message : 'Failed to delete deck';

    if (message.includes('Only the deck owner')) {
      return NextResponse.json({ error: message }, { status: 403 });
    }

    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
