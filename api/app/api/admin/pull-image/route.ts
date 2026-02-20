/**
 * POST /api/admin/pull-image — Broadcast a pull-image command to all active workers.
 * Protected by WORKER_SECRET header (same auth used by CI and worker).
 */
import { NextRequest, NextResponse } from 'next/server';
import { isWorkerRequest } from '@/lib/auth';
import { pushToAllWorkers } from '@/lib/worker-push';

const IS_LOCAL_MODE = !process.env.GOOGLE_CLOUD_PROJECT;

export async function POST(req: NextRequest) {
  if (!IS_LOCAL_MODE && !isWorkerRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await pushToAllWorkers('/pull-image', {});
    return NextResponse.json({ ok: true, message: 'Pull-image broadcast sent' });
  } catch (error) {
    console.error('[AdminPullImage] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Broadcast failed' },
      { status: 500 }
    );
  }
}
