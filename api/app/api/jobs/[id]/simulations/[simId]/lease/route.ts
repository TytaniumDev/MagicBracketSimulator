import { NextRequest, NextResponse } from 'next/server';
import { isWorkerOrAllowlistedUser } from '@/lib/worker-auth';
import { extendSimLease } from '@/lib/job-store-factory';
import { errorResponse, badRequestResponse } from '@/lib/api-response';
import * as Sentry from '@sentry/nextjs';

interface RouteParams {
  params: Promise<{ id: string; simId: string }>;
}

/**
 * POST /api/jobs/[id]/simulations/[simId]/lease — Extend a running sim's lease.
 *
 * Workers that claim with `?lease=1` call this about once a minute per
 * running sim. Body: { workerId }. Returns { status } where status is one of
 * SimLeaseStatus: 'extended' (keep going), 'cancelled' (the job was
 * cancelled; stop) or 'lost' (the sim is no longer this worker's; stop
 * without reporting a result).
 *
 * Auth: X-Worker-Secret (Docker worker) or an allowlisted user's Firebase ID
 * token (desktop worker).
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  if (!(await isWorkerOrAllowlistedUser(request))) {
    return errorResponse('Unauthorized', 401);
  }

  const { id, simId } = await params;
  const body = await request.json().catch(() => null);
  const workerId = body?.workerId;
  if (typeof workerId !== 'string' || workerId === '') {
    return badRequestResponse('workerId is required');
  }

  try {
    const status = await extendSimLease(id, simId, workerId);
    return NextResponse.json({ status });
  } catch (error) {
    Sentry.captureException(error, {
      tags: { component: 'api-route', route: 'POST /api/jobs/[id]/simulations/[simId]/lease' },
    });
    return errorResponse(error instanceof Error ? error.message : 'Failed to extend lease', 500);
  }
}
