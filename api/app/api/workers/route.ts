import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, unauthorizedResponse } from '@/lib/auth';
import * as workerStore from '@/lib/worker-store-factory';
import { errorResponse } from '@/lib/api-response';
import * as Sentry from '@sentry/nextjs';

/**
 * GET /api/workers — List active workers and queue depth (public).
 */
export async function GET(request: NextRequest) {
  try {
    await verifyAuth(request);
  } catch {
    return unauthorizedResponse();
  }

  try {
    const [workers, queueDepth] = await Promise.all([
      workerStore.getActiveWorkers(),
      workerStore.getQueueDepth(),
    ]);

    return NextResponse.json({ workers, queueDepth });
  } catch (error) {
    console.error('GET /api/workers error:', error);
    Sentry.captureException(error, { tags: { component: 'api-route', route: 'GET /api/workers' } });
    return errorResponse(error instanceof Error ? error.message : 'Failed to get workers', 500);
  }
}
