import { NextRequest, NextResponse } from 'next/server';
import { optionalAuth, unauthorizedResponse, isWorkerRequest } from '@/lib/auth';
import { getRawLogs } from '@/lib/log-store';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/jobs/[id]/logs/raw — Return raw game logs.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  if (!isWorkerRequest(request)) {
    const user = await optionalAuth(request);
    if (!user) return unauthorizedResponse();
  }

  try {
    const { id } = await params;
    const gameLogs = await getRawLogs(id);
    if (!gameLogs) {
      return NextResponse.json({ error: 'Logs not found for this job' }, { status: 404 });
    }
    return NextResponse.json({ gameLogs });
  } catch (error) {
    console.error('GET /api/jobs/[id]/logs/raw error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get raw logs' },
      { status: 500 }
    );
  }
}
