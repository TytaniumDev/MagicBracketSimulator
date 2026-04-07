import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, unauthorizedResponse } from '@/lib/auth';
import { listAllDecks } from '@/lib/deck-store-factory';
import { errorResponse } from '@/lib/api-response';

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
    return errorResponse('Failed to list decks', 500);
  }
}
