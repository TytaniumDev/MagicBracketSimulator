import { NextRequest, NextResponse } from 'next/server';
import { verifyAllowedUser, unauthorizedResponse } from '@/lib/auth';
import { getGameIndex } from '@/lib/log-store';
import * as jobStore from '@/lib/job-store-factory';
import { errorResponse, notFoundResponse } from '@/lib/api-response';
import type { GameListResponse } from '@/lib/types';
import * as Sentry from '@sentry/nextjs';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/jobs/[id]/logs/games — Every game of a job with its winner, in
 * play order. Fetch one game's logs from `games/[n]`.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    await verifyAllowedUser(request);
  } catch {
    return unauthorizedResponse();
  }

  try {
    const { id } = await params;
    const job = await jobStore.getJob(id);
    const gameIndex = await getGameIndex(id, job?.seats.map((s) => s.name));
    if (!gameIndex) {
      return notFoundResponse('Logs');
    }
    const body: GameListResponse = {
      deckNames: gameIndex.deckNames,
      games: gameIndex.games.map(({ winner, winningTurn }) => ({ winner, winningTurn })),
    };
    return NextResponse.json(body, {
      headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=86400' },
    });
  } catch (error) {
    console.error('GET /api/jobs/[id]/logs/games error:', error);
    Sentry.captureException(error, { tags: { component: 'api-route', route: 'GET /api/jobs/[id]/logs/games' } });
    return errorResponse(error instanceof Error ? error.message : 'Failed to list games', 500);
  }
}
