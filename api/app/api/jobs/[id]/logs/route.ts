import { NextRequest, NextResponse } from 'next/server';
import { optionalAllowedUser, unauthorizedResponse, isWorkerRequest } from '@/lib/auth';
import { ingestLogs } from '@/lib/log-store';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/jobs/[id]/logs — Ingest raw game logs for a job.
 * Called by the simulation worker after a job completes.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  if (!isWorkerRequest(request)) {
    const user = await optionalAllowedUser(request);
    if (!user) return unauthorizedResponse();
  }

  try {
    const { id } = await params;
    const body = await request.json();
    const { gameLogs, deckNames, deckLists } = body;

    if (!gameLogs || !Array.isArray(gameLogs) || gameLogs.length === 0) {
      return NextResponse.json({ error: 'gameLogs array is required and must not be empty' }, { status: 400 });
    }

    const { gameCount } = await ingestLogs(id, gameLogs, deckNames, deckLists);

    return NextResponse.json(
      { message: 'Logs ingested successfully', jobId: id, gameCount },
      { status: 201 }
    );
  } catch (error) {
    console.error('POST /api/jobs/[id]/logs error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to ingest logs' },
      { status: 500 }
    );
  }
}
