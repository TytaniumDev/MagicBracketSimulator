import { NextRequest, NextResponse } from 'next/server';
import { isWorkerRequest, unauthorizedResponse } from '@/lib/auth';
import { readDeckContent } from '@/lib/deck-store-factory';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/decks/[id]/content - Get deck content (name + dck) for workers.
 * Auth: worker only (X-Worker-Secret). Returns 404 if deck not found.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  if (!isWorkerRequest(request)) {
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

    const content = await readDeckContent(id);

    if (!content) {
      return NextResponse.json(
        { error: 'Deck not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(content);
  } catch (error) {
    console.error('Failed to get deck content:', error);
    return NextResponse.json(
      { error: 'Failed to get deck content' },
      { status: 500 }
    );
  }
}
