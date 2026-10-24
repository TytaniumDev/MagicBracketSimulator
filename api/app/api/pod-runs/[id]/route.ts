import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, unauthorizedResponse } from '@/lib/auth';
import { getPodRunStore } from '@/lib/pod-run-store-factory';
import { podRunToResponse } from '@/lib/pod-run-utils';
import { errorResponse, notFoundResponse } from '@/lib/api-response';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/pod-runs/:id - One pod run, with its job ids
 * Returns: PodRunResponse
 */
export async function GET(request: NextRequest, { params }: RouteParams): Promise<NextResponse | Response> {
  try {
    await verifyAuth(request);
  } catch {
    return unauthorizedResponse();
  }

  try {
    const { id } = await params;
    const run = await (await getPodRunStore()).getPodRun(id);
    if (!run) return notFoundResponse('Pod run');
    return NextResponse.json(podRunToResponse(run));
  } catch (error) {
    console.error('GET /api/pod-runs/[id] error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Failed to get pod run', 500);
  }
}
