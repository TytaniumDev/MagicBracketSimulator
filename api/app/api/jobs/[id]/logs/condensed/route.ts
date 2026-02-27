import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, unauthorizedResponse } from '@/lib/auth';
import { getCondensedLogs } from '@/lib/log-store';
import { errorResponse, notFoundResponse } from '@/lib/api-response';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/jobs/[id]/logs/condensed — Return condensed game data.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    await verifyAuth(request);
  } catch {
    return unauthorizedResponse();
  }

  try {
    const { id } = await params;
    const condensed = await getCondensedLogs(id);
    if (!condensed) {
      return notFoundResponse('Logs');
    }
    return NextResponse.json({ condensed }, {
      headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=86400' },
    });
  } catch (error) {
    console.error('GET /api/jobs/[id]/logs/condensed error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Failed to get condensed logs', 500);
  }
}
