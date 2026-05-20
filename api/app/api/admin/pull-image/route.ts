/**
 * POST /api/admin/pull-image — Broadcast a pull-image command to all active workers.
 * Protected by WORKER_SECRET header (same auth used by CI and worker).
 */
import { NextRequest, NextResponse } from 'next/server';
import { isWorkerRequest } from '@/lib/auth';
import { pushToAllWorkers } from '@/lib/worker-push';
import { errorResponse } from '@/lib/api-response';

import { isLocalMode } from '@/lib/env';

const IS_LOCAL_MODE = isLocalMode();

export async function POST(req: NextRequest) {
  if (!IS_LOCAL_MODE && !isWorkerRequest(req)) {
    return errorResponse('Unauthorized', 401);
  }

  try {
    await pushToAllWorkers('/pull-image', {});
    return NextResponse.json({ ok: true, message: 'Pull-image broadcast sent' });
  } catch (error) {
    console.error('[AdminPullImage] Error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Broadcast failed', 500);
  }
}
