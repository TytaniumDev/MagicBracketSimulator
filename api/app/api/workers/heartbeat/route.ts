import { NextRequest, NextResponse } from 'next/server';
import { isWorkerRequest, unauthorizedResponse } from '@/lib/auth';
import * as workerStore from '@/lib/worker-store-factory';
import type { WorkerInfo } from '@/lib/types';

/**
 * POST /api/workers/heartbeat — Worker heartbeat.
 * Called by workers every 15 seconds to report status.
 */
export async function POST(request: NextRequest) {
  if (!isWorkerRequest(request)) {
    return unauthorizedResponse('Worker authentication required');
  }

  try {
    const body = await request.json();
    const { workerId, workerName, status, currentJobId, capacity, activeSimulations, uptimeMs, version, ownerEmail, workerApiUrl } = body;

    if (!workerId || !workerName) {
      return NextResponse.json({ error: 'workerId and workerName are required' }, { status: 400 });
    }

    const info: WorkerInfo = {
      workerId,
      workerName,
      status: status === 'busy' ? 'busy' : status === 'updating' ? 'updating' : 'idle',
      ...(currentJobId && { currentJobId }),
      capacity: typeof capacity === 'number' ? capacity : 0,
      activeSimulations: typeof activeSimulations === 'number' ? activeSimulations : 0,
      uptimeMs: typeof uptimeMs === 'number' ? uptimeMs : 0,
      lastHeartbeat: new Date().toISOString(),
      ...(version && { version }),
      ...(ownerEmail && { ownerEmail }),
      ...(workerApiUrl && { workerApiUrl }),
    };

    await workerStore.upsertHeartbeat(info);

    // Return any stored override so the worker can apply it dynamically
    const override = await workerStore.getMaxConcurrentOverride(workerId);
    return NextResponse.json({
      ok: true,
      ...(override !== null && override !== undefined && { maxConcurrentOverride: override }),
    });
  } catch (error) {
    console.error('POST /api/workers/heartbeat error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Heartbeat failed' },
      { status: 500 }
    );
  }
}
