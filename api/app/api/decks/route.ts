import { NextRequest, NextResponse } from 'next/server';
import { verifyAllowedUser, verifyAdmin, unauthorizedResponse } from '@/lib/auth';
import { listAllDecks } from '@/lib/deck-store-factory';
import { getDeckSelectionStore } from '@/lib/deck-selection-store-factory';
import { badRequestResponse, errorResponse } from '@/lib/api-response';
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

/** Firestore commits at most 500 writes in one batch. */
const MAX_DECKS_PER_UPDATE = 500;

/**
 * PATCH /api/decks - Exclude decks from selection, or include them again,
 * in one write (admin only). Body: { deckIds: string[], excluded: boolean }.
 * Returns { excludedDeckIds }.
 */
export async function PATCH(request: NextRequest) {
  let email: string;
  try {
    ({ email } = await verifyAdmin(request));
  } catch (error) {
    return unauthorizedResponse(error instanceof Error ? error.message : undefined);
  }

  try {
    const body = await request.json().catch(() => null);
    const deckIds: unknown = body?.deckIds;
    if (
      !Array.isArray(deckIds) ||
      deckIds.length === 0 ||
      deckIds.length > MAX_DECKS_PER_UPDATE ||
      !deckIds.every((id) => typeof id === 'string' && id.length > 0)
    ) {
      return badRequestResponse(`deckIds must be 1 to ${MAX_DECKS_PER_UPDATE} deck ids`);
    }
    if (typeof body.excluded !== 'boolean') {
      return badRequestResponse('excluded must be a boolean');
    }

    const store = await getDeckSelectionStore();
    const excludedDeckIds = await store.setDecksExcluded(deckIds as string[], body.excluded, email);
    return NextResponse.json({ excludedDeckIds });
  } catch (error) {
    console.error('Failed to update deck selection:', error);
    Sentry.captureException(error, { tags: { component: 'api-route', route: 'PATCH /api/decks' } });
    return errorResponse('Failed to update deck selection', 500);
  }
}
