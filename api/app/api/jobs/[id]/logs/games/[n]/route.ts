import { NextRequest, NextResponse } from 'next/server';
import { verifyAllowedUser, unauthorizedResponse } from '@/lib/auth';
import { getGameLog } from '@/lib/log-store';
import * as jobStore from '@/lib/job-store-factory';
import { badRequestResponse, errorResponse, notFoundResponse } from '@/lib/api-response';
import * as Sentry from '@sentry/nextjs';

interface RouteParams {
  params: Promise<{ id: string; n: string }>;
}

/**
 * GET /api/jobs/[id]/logs/games/[n] — One game's raw log with its condensed
 * and structured views. `n` counts from 0 in play order.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    await verifyAllowedUser(request);
  } catch {
    return unauthorizedResponse();
  }

  try {
    const { id, n } = await params;
    const gameNumber = Number(n);
    if (!Number.isInteger(gameNumber) || gameNumber < 0) {
      return badRequestResponse('Game number must be a whole number from 0');
    }
    const job = await jobStore.getJob(id);
    const game = await getGameLog(id, gameNumber, job?.seats.map((s) => s.name));
    if (!game) {
      return notFoundResponse('Game');
    }
    return NextResponse.json(game, {
      headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=86400' },
    });
  } catch (error) {
    console.error('GET /api/jobs/[id]/logs/games/[n] error:', error);
    Sentry.captureException(error, { tags: { component: 'api-route', route: 'GET /api/jobs/[id]/logs/games/[n]' } });
    return errorResponse(error instanceof Error ? error.message : 'Failed to get game log', 500);
  }
}
