import { NextRequest, NextResponse } from 'next/server';
import { isWorkerRequest, unauthorizedResponse } from '@/lib/auth';
import { readDeckContent } from '@/lib/deck-store-factory';
import { errorResponse, notFoundResponse, badRequestResponse } from '@/lib/api-response';

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
      return badRequestResponse('Deck ID is required');
    }

    const content = await readDeckContent(id);

    if (!content) {
      return notFoundResponse('Deck');
    }

    return NextResponse.json(content);
  } catch (error) {
    console.error('Failed to get deck content:', error);
    return errorResponse('Failed to get deck content', 500);
  }
}
