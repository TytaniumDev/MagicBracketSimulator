/**
 * POST /api/admin/sweep-leases
 *
 * Invoked by Cloud Tasks every ~12 seconds. Reverts RUNNING sims whose
 * owning worker's lease has expired, marks the worker crashed, then
 * self-reschedules.
 *
 * In LOCAL mode (no GOOGLE_CLOUD_PROJECT), the Firestore worker store is
 * not in use, so this endpoint is a no-op returning empty stats.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { isWorkerRequest } from '@/lib/auth';
import { sweepExpiredLeases } from '@/lib/lease-sweep';
import {
  getWorkersWithExpiredLeases,
  markWorkerCrashed,
} from '@/lib/firestore-worker-store';
import { revertSimToPending } from '@/lib/job-store-factory';
import { scheduleLeaseSweep } from '@/lib/cloud-tasks';

const USE_FIRESTORE = typeof process.env.GOOGLE_CLOUD_PROJECT === 'string'
  && process.env.GOOGLE_CLOUD_PROJECT.length > 0;

export async function POST(req: NextRequest) {
  if (!isWorkerRequest(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (!USE_FIRESTORE) {
    return NextResponse.json({
      workersScanned: 0,
      simsReverted: 0,
      errors: [],
      mode: 'local-noop',
    });
  }

  const startedAt = Date.now();
  let result;
  try {
    result = await sweepExpiredLeases({
      getWorkersWithExpiredLeases,
      revertSimToPending,
      markWorkerCrashed,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({
      event: 'lease-sweep-error',
      message,
      durationMs: Date.now() - startedAt,
    }));
    // Still attempt to reschedule so a transient error doesn't break the chain.
    await scheduleLeaseSweep();
    return NextResponse.json({ error: message }, { status: 500 });
  }

  console.log(JSON.stringify({
    event: 'lease-sweep-complete',
    workersScanned: result.workersScanned,
    simsReverted: result.simsReverted,
    errors: result.errors,
    durationMs: Date.now() - startedAt,
  }));

  await scheduleLeaseSweep();
  return NextResponse.json(result);
}
