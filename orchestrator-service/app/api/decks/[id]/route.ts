import { NextResponse } from 'next/server';
import { deleteSavedDeck } from '@/lib/saved-decks';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * DELETE /api/decks/[id] - Delete a saved deck by filename
 */
export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    
    if (!id) {
      return NextResponse.json(
        { error: 'Deck ID is required' },
        { status: 400 }
      );
    }

    // The id is the filename (e.g., "doran-big-butts.dck")
    const deleted = deleteSavedDeck(id);

    if (!deleted) {
      return NextResponse.json(
        { error: 'Deck not found' },
        { status: 404 }
      );
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('Failed to delete deck:', error);
    const message = error instanceof Error ? error.message : 'Failed to delete deck';
    
    // If it's an invalid filename error, return 400
    if (message === 'Invalid deck filename') {
      return NextResponse.json(
        { error: message },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
