import { NextRequest, NextResponse } from 'next/server';
import { isWorkerRequest } from '@/lib/auth';
import { claimNextJob } from '@/lib/job-store-factory';
import { errorResponse } from '@/lib/api-response';

/**
 * GET /api/jobs/next — Atomically claim the next QUEUED job.
 * Used by the unified worker in polling (local) mode.
 * Auth: X-Worker-Secret header only.
 */
export async function GET(request: NextRequest) {
  if (!isWorkerRequest(request)) {
    return errorResponse('Unauthorized', 401);
  }

  try {
    const job = await claimNextJob();
    if (!job) {
      return new NextResponse(null, { status: 204 });
    }
    return NextResponse.json(job);
  } catch (error) {
    console.error('GET /api/jobs/next error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Failed to claim next job', 500);
  }
}
