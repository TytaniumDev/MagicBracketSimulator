import { NextRequest, NextResponse } from 'next/server';
import { optionalAllowedUser, unauthorizedResponse } from '@/lib/auth';
import { ingestLogs } from '@/lib/log-store';
import { errorResponse, badRequestResponse } from '@/lib/api-response';
import * as Sentry from '@sentry/nextjs';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/jobs/[id]/logs — Ingest raw game logs for a job.
 * Auth: allowed users.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const user = await optionalAllowedUser(request);
  if (!user) return unauthorizedResponse();

  try {
    const { id } = await params;
    const body = await request.json();
    const { gameLogs, deckNames, deckLists } = body;

    if (!gameLogs || !Array.isArray(gameLogs) || gameLogs.length === 0) {
      return badRequestResponse('gameLogs array is required and must not be empty');
    }

    const { gameCount } = await ingestLogs(id, gameLogs, deckNames, deckLists);

    return NextResponse.json(
      { message: 'Logs ingested successfully', jobId: id, gameCount },
      { status: 201 }
    );
  } catch (error) {
    console.error('POST /api/jobs/[id]/logs error:', error);
    Sentry.captureException(error, { tags: { component: 'api-route', route: 'POST /api/jobs/[id]/logs' } });
    return errorResponse(error instanceof Error ? error.message : 'Failed to ingest logs', 500);
  }
}
