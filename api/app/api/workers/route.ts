import { NextResponse } from 'next/server';
import * as workerStore from '@/lib/worker-store-factory';

/**
 * GET /api/workers — List active workers and queue depth (public).
 */
export async function GET() {
  try {
    const [workers, queueDepth] = await Promise.all([
      workerStore.getActiveWorkers(),
      workerStore.getQueueDepth(),
    ]);

    return NextResponse.json({ workers, queueDepth });
  } catch (error) {
    console.error('GET /api/workers error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get workers' },
      { status: 500 }
    );
  }
}
