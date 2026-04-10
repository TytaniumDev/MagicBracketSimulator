import { NextRequest, NextResponse } from 'next/server';
import { isWorkerRequest, unauthorizedResponse } from '@/lib/auth';
import * as workerStore from '@/lib/worker-store-factory';
import type { WorkerInfo } from '@/lib/types';
import { errorResponse, badRequestResponse } from '@/lib/api-response';

/**
 * POST /api/workers/heartbeat — Worker heartbeat.
 *
 * Writes the worker's current status to Firestore so the frontend knows
 * which workers are online. Expected cadence: every 60 seconds
 * (see HEARTBEAT_INTERVAL_MS in worker/src/worker.ts).
 *
 * Runtime concurrency overrides are delivered via the worker's own push
 * HTTP API (POST /config) — the heartbeat response does NOT ship them on
 * every beat, because the read was billing a Firestore read for every
 * 15-second beat on data that almost never changes.
 *
 * Workers query for their initial override via `?initial=1` on their very
 * first heartbeat after startup. That's the only path where the API does
 * the extra Firestore read.
 */
export async function POST(request: NextRequest) {
  if (!isWorkerRequest(request)) {
    return unauthorizedResponse('Worker authentication required');
  }

  try {
    const body = await request.json();
    const { workerId, workerName, status, currentJobId, capacity, activeSimulations, uptimeMs, version, ownerEmail, workerApiUrl } = body;

    if (!workerId || !workerName) {
      return badRequestResponse('workerId and workerName are required');
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

    // Initial-sync beat only: return any stored override so the worker can
    // pick up a setting set while it was offline. Subsequent beats skip
    // the read to keep Firestore ops (and Cloud Run wake-ups) to one
    // write per minute per worker.
    const isInitialSync = new URL(request.url).searchParams.get('initial') === '1';
    if (isInitialSync) {
      const override = await workerStore.getMaxConcurrentOverride(workerId);
      return NextResponse.json({
        ok: true,
        ...(override !== null && override !== undefined && { maxConcurrentOverride: override }),
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('POST /api/workers/heartbeat error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Heartbeat failed', 500);
  }
}
