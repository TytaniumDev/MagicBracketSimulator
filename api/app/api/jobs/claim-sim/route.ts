import { NextRequest, NextResponse } from 'next/server';
import { isWorkerRequest } from '@/lib/auth';
import { claimNextSim } from '@/lib/job-store-factory';
import { errorResponse, badRequestResponse } from '@/lib/api-response';

/**
 * GET /api/jobs/claim-sim — Atomically claim the next PENDING simulation.
 *
 * The worker's polling entry point. Replaces the Pub/Sub subscription that
 * previously delivered SimulationTaskMessages one-per-sim. The claim flips
 * the chosen sim from PENDING to RUNNING with the caller's workerId, and
 * promotes its job from QUEUED to RUNNING if this is the first claim.
 *
 * Query params:
 *   workerId   — stable identifier for reclaim heuristics and audit
 *   workerName — display name surfaced on the job detail UI
 *
 * Returns 200 { jobId, simId, simIndex } on success, 204 when no work is
 * available. Auth: X-Worker-Secret (shared with the other worker endpoints).
 */
export async function GET(request: NextRequest) {
  if (!isWorkerRequest(request)) {
    return errorResponse('Unauthorized', 401);
  }

  const url = new URL(request.url);
  const workerId = url.searchParams.get('workerId');
  const workerName = url.searchParams.get('workerName');
  if (!workerId || !workerName) {
    return badRequestResponse('workerId and workerName query params are required');
  }

  try {
    const claimed = await claimNextSim(workerId, workerName);
    if (!claimed) return new NextResponse(null, { status: 204 });
    return NextResponse.json(claimed);
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to claim sim',
      500,
    );
  }
}
