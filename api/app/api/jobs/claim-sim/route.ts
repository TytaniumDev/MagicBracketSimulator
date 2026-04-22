import { NextRequest, NextResponse } from 'next/server';
import { isWorkerRequest } from '@/lib/auth';
import { claimNextSim } from '@/lib/job-store-factory';
import * as workerStore from '@/lib/worker-store-factory';
import { errorResponse, badRequestResponse } from '@/lib/api-response';
import { OVERRIDE_HEADER_NAME, encodeOverrideHeader } from '@/lib/override-header';

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
 *
 * Every response carries the worker's current concurrency override in the
 * `X-Max-Concurrent-Override` header (a positive integer, or `none` when
 * unset). This is the responsive fallback for runtime override changes
 * when the push-based /config path is unavailable (worker behind NAT /
 * WORKER_API_URL unset). The worker applies it via applyOverride() on
 * every poll.
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
    const [claimed, overrideResult] = await Promise.all([
      claimNextSim(workerId, workerName),
      // Best-effort: if this fails we omit the header and the worker just
      // keeps its last-known override. Don't let it orphan a successful claim.
      workerStore.getMaxConcurrentOverride(workerId).catch(() => undefined),
    ]);

    const overrideHeader: Record<string, string> = {};
    if (overrideResult !== undefined) {
      overrideHeader[OVERRIDE_HEADER_NAME] = encodeOverrideHeader(overrideResult);
    }

    if (!claimed) return new NextResponse(null, { status: 204, headers: overrideHeader });
    return NextResponse.json(claimed, { headers: overrideHeader });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to claim sim',
      500,
    );
  }
}
