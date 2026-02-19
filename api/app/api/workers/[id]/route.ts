import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import * as workerStore from '@/lib/worker-store-factory';
import { pushToWorker } from '@/lib/worker-push';

/**
 * PATCH /api/workers/:id — Update per-worker config (owner-gated).
 * Currently supports setting maxConcurrentOverride.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await verifyAuth(request);
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
        return NextResponse.json(
          { error: 'maxConcurrentOverride must be null or an integer between 1 and 20' },
          { status: 400 }
        );
      }
    }

    // Ownership check: only the worker owner can change settings
    const ownerEmail = await workerStore.getOwnerEmail(workerId);
    if (ownerEmail && ownerEmail.toLowerCase() !== user.email.toLowerCase()) {
      return NextResponse.json(
        { error: 'Only the worker owner can change this setting' },
        { status: 403 }
      );
    }

    const updated = await workerStore.setMaxConcurrentOverride(workerId, maxConcurrentOverride);
    if (!updated) {
      return NextResponse.json({ error: 'Worker not found' }, { status: 404 });
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
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    console.error('PATCH /api/workers/[id] error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Update failed' },
      { status: 500 }
    );
  }
}
