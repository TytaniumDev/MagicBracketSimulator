import { NextRequest, NextResponse } from 'next/server';
import { isWorkerRequest, unauthorizedResponse } from '@/lib/auth';
import { uploadSingleSimulationLog } from '@/lib/log-store';
import { errorResponse, badRequestResponse } from '@/lib/api-response';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/jobs/[id]/logs/simulation — Upload a single simulation's raw log.
 * Called by the worker incrementally after each simulation completes.
 * Body: { filename: string, logText: string }
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  if (!isWorkerRequest(request)) {
    return unauthorizedResponse('Worker authentication required');
  }

  try {
    const { id } = await params;
    const body = await request.json();
    const { filename, logText } = body;

    if (!filename || typeof filename !== 'string') {
      return badRequestResponse('filename is required');
    }
    if (!logText || typeof logText !== 'string') {
      return badRequestResponse('logText is required');
    }

    await uploadSingleSimulationLog(id, filename, logText);

    return NextResponse.json({ uploaded: true }, { status: 201 });
  } catch (error) {
    console.error('POST /api/jobs/[id]/logs/simulation error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Failed to upload log', 500);
  }
}
