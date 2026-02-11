import { NextRequest, NextResponse } from 'next/server';
import { optionalAuth, unauthorizedResponse, isWorkerRequest } from '@/lib/auth';
import { getStructuredLogs } from '@/lib/log-store';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/jobs/[id]/logs/structured — Return structured games for UI visualization.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  if (!isWorkerRequest(request)) {
    const user = await optionalAuth(request);
    if (!user) return unauthorizedResponse();
  }

  try {
    const { id } = await params;
    const result = await getStructuredLogs(id);
    if (!result) {
      return NextResponse.json({ error: 'Logs not found for this job' }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error('GET /api/jobs/[id]/logs/structured error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get structured logs' },
      { status: 500 }
    );
  }
}
