import { NextRequest, NextResponse } from 'next/server';
import { verifyAllowedUser, unauthorizedResponse } from '@/lib/auth';
import { claimNextSim } from '@/lib/job-store-factory';
import { errorResponse, badRequestResponse } from '@/lib/api-response';
import * as Sentry from '@sentry/nextjs';

/**
 * GET /api/jobs/claim-sim — Atomically claim the next PENDING simulation.
 *
 * The desktop worker's polling entry point. The claim flips
 * the chosen sim from PENDING to RUNNING with the caller's workerId, and
 * promotes its job from QUEUED to RUNNING if this is the first claim.
 *
 * Query params:
 *   workerId   — stable identifier for reclaim heuristics and audit
 *   workerName — display name surfaced on the job detail UI
 *   lease=1    — reserve the sim with a lease the worker extends via
 *                POST /api/jobs/:id/simulations/:simId/lease (see sim-lease.ts)
 *
 * Returns 200 { jobId, simId, simIndex } on success, 204 when no work is
 * available. Auth: an allowed user's Firebase ID token (the desktop worker
 * signs in as its owner).
 */
export async function GET(request: NextRequest) {
  try {
    await verifyAllowedUser(request);
  } catch {
    return unauthorizedResponse();
  }

  const url = new URL(request.url);
  const workerId = url.searchParams.get('workerId');
  const workerName = url.searchParams.get('workerName');
  const withLease = url.searchParams.get('lease') === '1';
  if (!workerId || !workerName) {
    return badRequestResponse('workerId and workerName query params are required');
  }

  try {
    const claimed = await claimNextSim(workerId, workerName, { withLease });
    if (!claimed) return new NextResponse(null, { status: 204 });
    return NextResponse.json(claimed);
  } catch (error) {
    Sentry.captureException(error, { tags: { component: 'api-route', route: 'GET /api/jobs/claim-sim' } });
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to claim sim',
      500,
    );
  }
}
