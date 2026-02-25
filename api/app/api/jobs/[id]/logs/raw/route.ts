import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, unauthorizedResponse } from '@/lib/auth';
import { getRawLogs } from '@/lib/log-store';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/jobs/[id]/logs/raw — Return raw game logs.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    await verifyAuth(request);
  } catch {
    return unauthorizedResponse();
  }

  try {
    const { id } = await params;
    const gameLogs = await getRawLogs(id);
    if (!gameLogs) {
      return NextResponse.json({ error: 'Logs not found for this job' }, { status: 404 });
    }
    return NextResponse.json({ gameLogs }, {
      headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=86400' },
    });
  } catch (error) {
    console.error('GET /api/jobs/[id]/logs/raw error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get raw logs' },
      { status: 500 }
    );
  }
}
