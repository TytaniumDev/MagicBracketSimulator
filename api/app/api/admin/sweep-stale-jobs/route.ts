/**
 * POST /api/admin/sweep-stale-jobs — Run one pass of the stale-job sweeper.
 *
 * Invoked on a 15-minute schedule by Cloud Scheduler. Authed with the existing
 * WORKER_SECRET header (same as /api/admin/pull-image). In local mode the
 * auth check is bypassed so the endpoint is callable in dev without setup.
 *
 * Returns a SweepResult JSON describing what was scanned, cancelled, and
 * aggregated. Errors inside individual job processing are captured to Sentry
 * and also surfaced in the response so the Cloud Scheduler invocation log
 * shows them.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isWorkerRequest } from '@/lib/auth';
import { sweepStaleJobs } from '@/lib/stale-sweeper';
import { errorResponse } from '@/lib/api-response';

const IS_LOCAL_MODE = !process.env.GOOGLE_CLOUD_PROJECT;

export async function POST(req: NextRequest) {
  if (!IS_LOCAL_MODE && !isWorkerRequest(req)) {
    return errorResponse('Unauthorized', 401);
  }

  try {
    const result = await sweepStaleJobs();
    return NextResponse.json(result);
  } catch (error) {
    console.error('[StaleSweeper] Error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Sweep failed', 500);
  }
}
