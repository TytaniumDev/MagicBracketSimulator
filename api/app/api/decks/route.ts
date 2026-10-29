import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, unauthorizedResponse } from '@/lib/auth';
import { listAllDecks } from '@/lib/deck-store-factory';
import { errorResponse } from '@/lib/api-response';
import * as Sentry from '@sentry/nextjs';

/**
 * GET /api/decks - List all decks (precons + every user's submissions, public)
 */
export async function GET(request: NextRequest) {
  try {
    await verifyAuth(request);
  } catch {
    return unauthorizedResponse();
  }

  try {
    const decks = await listAllDecks();
    return NextResponse.json({ decks });
  } catch (error) {
    console.error('Failed to list decks:', error);
    Sentry.captureException(error, { tags: { component: 'api-route', route: 'GET /api/decks' } });
    return errorResponse('Failed to list decks', 500);
  }
}
