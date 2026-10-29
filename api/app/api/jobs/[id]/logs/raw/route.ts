import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, unauthorizedResponse } from '@/lib/auth';
import { getRawLogs } from '@/lib/log-store';
import { errorResponse, notFoundResponse } from '@/lib/api-response';
import * as Sentry from '@sentry/nextjs';

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
      return notFoundResponse('Logs');
    }
    return NextResponse.json({ gameLogs }, {
      headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=86400' },
    });
  } catch (error) {
    console.error('GET /api/jobs/[id]/logs/raw error:', error);
    Sentry.captureException(error, { tags: { component: 'api-route', route: 'GET /api/jobs/[id]/logs/raw' } });
    return errorResponse(error instanceof Error ? error.message : 'Failed to get raw logs', 500);
  }
}
