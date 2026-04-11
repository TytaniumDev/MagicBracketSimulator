import { NextResponse } from 'next/server';
import * as workerStore from '@/lib/worker-store-factory';

/**
 * GET /api/health/workers — Lightweight worker-pool liveness probe.
 *
 * Returns HTTP 200 when at least one worker has heartbeated in the last
 * `staleThresholdMs` (default 3 minutes) and HTTP 503 otherwise.
 *
 * Purpose:
 *   - Frontend uses this to show a "no workers online" banner so users
 *     understand why their QUEUED jobs aren't progressing.
 *   - Cloud Monitoring can alert on sustained 503s to page an operator.
 *
 * Intentionally minimal: one Firestore query, no auth (same as /api/health),
 * no other subsystem checks. The full `/api/health` endpoint remains for
 * multi-check observability.
 */
export async function GET() {
  try {
    const workers = await workerStore.getActiveWorkers();
    const online = workers.length;
    const body = {
      online,
      workers: workers.map((w) => ({
        workerId: w.workerId,
        workerName: w.workerName,
        lastHeartbeat: w.lastHeartbeat,
        status: w.status,
      })),
    };
    const status = online > 0 ? 200 : 503;
    return NextResponse.json(body, { status });
  } catch (err) {
    return NextResponse.json(
      { online: 0, error: err instanceof Error ? err.message : 'unknown' },
      { status: 503 }
    );
  }
}
