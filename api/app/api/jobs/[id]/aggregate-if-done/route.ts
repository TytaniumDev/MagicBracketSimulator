/**
 * POST /api/jobs/:id/aggregate-if-done — Fast-path aggregation trigger
 * for workers that write sim results directly to Firestore (notably
 * the Flutter desktop worker).
 *
 * The Docker worker reports sim results via PATCH
 * /api/jobs/:id/simulations/:simId, and that handler fires
 * `aggregateJobResults` inline. The Flutter worker bypasses the API
 * for sim writes (direct Firestore for low latency), so it has no
 * way to trigger aggregation from inside the request — without this
 * endpoint, Flutter-completed jobs sit in RUNNING until the 15-minute
 * stale-sweeper catches them.
 *
 * This endpoint:
 *   1. Auths the caller with WORKER_SECRET, or with the Firebase ID token
 *      of an allowlisted user (how the signed-in Flutter worker calls it).
 *   2. Calls `aggregateJobResults(id)`, which itself is idempotent —
 *      it short-circuits if (a) any sim is non-terminal, or (b) the
 *      job is already COMPLETED/FAILED. Safe to call from every sim
 *      terminal report.
 *
 * Errors are returned as 5xx so the caller can retry. Real callers
 * (the Flutter worker) treat failures as non-fatal — the stale
 * sweeper is still the safety net.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isWorkerOrAllowlistedUser } from '@/lib/worker-auth';
import { aggregateJobResults } from '@/lib/job-store-factory';
import { errorResponse } from '@/lib/api-response';

import { isLocalMode } from '@/lib/env';
import * as Sentry from '@sentry/nextjs';

const IS_LOCAL_MODE = isLocalMode();

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!IS_LOCAL_MODE && !(await isWorkerOrAllowlistedUser(req))) {
    return errorResponse('Unauthorized', 401);
  }
  const { id } = await params;
  if (!id) return errorResponse('Missing job id', 400);

  try {
    await aggregateJobResults(id);
    return NextResponse.json({ jobId: id, triggered: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    Sentry.captureException(err, { tags: { component: 'api-route', route: 'POST /api/jobs/[id]/aggregate-if-done' } });
    return errorResponse(`Aggregation failed: ${message}`, 500);
  }
}
