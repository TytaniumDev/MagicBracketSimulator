import { NextRequest, NextResponse } from 'next/server';
import { verifyAllowedUser } from '@/lib/auth';
import * as workerStore from '@/lib/worker-store-factory';
import { pushToWorker } from '@/lib/worker-push';
import { errorResponse, notFoundResponse, badRequestResponse } from '@/lib/api-response';

/**
 * PATCH /api/workers/:id — Update per-worker config (owner-gated).
 * Currently supports setting maxConcurrentOverride.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await verifyAllowedUser(request);
    const { id: workerId } = await params;

    const body = await request.json();
    const { maxConcurrentOverride } = body;

    // Validate: must be null (clear) or integer 1-20
    if (maxConcurrentOverride !== null) {
      if (
        typeof maxConcurrentOverride !== 'number' ||
        !Number.isInteger(maxConcurrentOverride) ||
        maxConcurrentOverride < 1 ||
        maxConcurrentOverride > 20
      ) {
        return badRequestResponse('maxConcurrentOverride must be null or an integer between 1 and 20');
      }
    }

    // Ownership check: only the worker owner can change settings
    const ownerEmail = await workerStore.getOwnerEmail(workerId);
    if (ownerEmail && ownerEmail.toLowerCase() !== user.email.toLowerCase()) {
      return errorResponse('Only the worker owner can change this setting', 403);
    }

    const updated = await workerStore.setMaxConcurrentOverride(workerId, maxConcurrentOverride);
    if (!updated) {
      return notFoundResponse('Worker');
    }

    // Push config to worker (best-effort)
    let pushResult: 'success' | 'failed' | 'no_url' = 'no_url';
    const workerApiUrl = await workerStore.getWorkerApiUrl(workerId);
    if (workerApiUrl) {
      const ok = await pushToWorker(workerApiUrl, '/config', { maxConcurrentOverride });
      pushResult = ok ? 'success' : 'failed';
    }

    return NextResponse.json({ ok: true, maxConcurrentOverride, pushResult });
  } catch (error) {
    if (error instanceof Error && (error.message.includes('token') || error.message.includes('Unauthorized') || error.message.includes('allowlist'))) {
      return errorResponse(error.message, 401);
    }
    console.error('PATCH /api/workers/[id] error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Update failed', 500);
  }
}
