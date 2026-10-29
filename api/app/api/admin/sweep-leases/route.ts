/**
 * POST /api/admin/sweep-leases — retired.
 *
 * This used to revert sims held by crashed desktop workers, fired by a
 * Cloud Tasks chain every ~12 seconds that rescheduled itself. Crash
 * recovery now runs off per-sim leases (see lib/sim-lease.ts), so the
 * endpoint answers 200 without rescheduling: the last queued task ends the
 * chain instead of being retried as a failure. Safe to delete once no
 * sweep tasks remain in the queue.
 */
import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json({ retired: true });
}
