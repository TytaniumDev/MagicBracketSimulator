import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, unauthorizedResponse } from '@/lib/auth';
import { setCurrentRefreshId } from '@/lib/worker-store-factory';
import { publishWorkerReportIn } from '@/lib/pubsub';

/**
 * POST /api/workers/request-report-in - Trigger workers to report in (frontend-triggered status check)
 * Auth: Firebase verifyAuth
 * Publishes one message to worker-report-in topic; workers that receive it will POST /api/workers/heartbeat.
 */
export async function POST(request: NextRequest) {
  try {
    await verifyAuth(request);
  } catch {
    return unauthorizedResponse();
  }

  try {
    const refreshId = crypto.randomUUID();
    await setCurrentRefreshId(refreshId);
    await publishWorkerReportIn(refreshId);
    return NextResponse.json({ refreshId });
  } catch (error) {
    console.error('Failed to request worker report-in:', error);
    return NextResponse.json(
      { error: 'Failed to request worker report-in' },
      { status: 500 }
    );
  }
}
