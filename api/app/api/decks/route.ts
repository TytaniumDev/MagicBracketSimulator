import { NextRequest, NextResponse } from 'next/server';
import { verifyAllowedUser, unauthorizedResponse } from '@/lib/auth';
import { listAllDecks } from '@/lib/deck-store-factory';
import { getDeckSelectionStore } from '@/lib/deck-selection-store-factory';
import { errorResponse } from '@/lib/api-response';
import * as Sentry from '@sentry/nextjs';

/**
 * GET /api/decks - List all decks (precons + every user's submissions, public)
 * and the ids of decks excluded from selection.
 */
export async function GET(request: NextRequest) {
  try {
    await verifyAllowedUser(request);
  } catch {
    return unauthorizedResponse();
  }

  try {
    const [decks, excludedDeckIds] = await Promise.all([
      listAllDecks(),
      getDeckSelectionStore().then((store) => store.getExcludedDeckIds()),
    ]);
    return NextResponse.json({ decks, excludedDeckIds });
  } catch (error) {
    console.error('Failed to list decks:', error);
    Sentry.captureException(error, { tags: { component: 'api-route', route: 'GET /api/decks' } });
    return errorResponse('Failed to list decks', 500);
  }
}
