import { NextRequest, NextResponse } from 'next/server';
import { isWorkerRequest, unauthorizedResponse } from '@/lib/auth';
import { upsertWorker } from '@/lib/worker-store-factory';

/**
 * POST /api/workers/heartbeat - Worker reports in (called when worker receives worker-report-in message)
 * Auth: X-Worker-Secret header
 * Body: { workerId: string, hostname?: string, subscription?: string, refreshId: string }
 */
export async function POST(request: NextRequest) {
  if (!isWorkerRequest(request)) {
    return unauthorizedResponse('Invalid or missing X-Worker-Secret');
  }

  try {
    const body = await request.json();
    const workerId = typeof body.workerId === 'string' ? body.workerId.trim() : '';
    const refreshId = typeof body.refreshId === 'string' ? body.refreshId.trim() : '';
    if (!workerId || !refreshId) {
      return NextResponse.json(
        { error: 'workerId and refreshId are required' },
        { status: 400 }
      );
    }
    const hostname = typeof body.hostname === 'string' ? body.hostname.trim() : undefined;
    const subscription = typeof body.subscription === 'string' ? body.subscription.trim() : undefined;

    await upsertWorker(workerId, { hostname, subscription, refreshId });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('Failed to process worker heartbeat:', error);
    return NextResponse.json(
      { error: 'Failed to process heartbeat' },
      { status: 500 }
    );
  }
}
