import { NextResponse } from 'next/server';
import * as jobStore from '@/lib/job-store-factory';
import * as workerStore from '@/lib/worker-store-factory';
import { getRatingStore } from '@/lib/rating-store-factory';
import { isJobStuck } from '@/lib/job-utils';

interface HealthCheck {
  ok: boolean;
  detail: string;
}

/**
 * GET /api/health — Unauthenticated system health endpoint.
 *
 * Checks:
 * 1. Stuck jobs: RUNNING in Firestore but all sims done
 * 2. Ratings populated: leaderboard is not empty
 * 3. Worker connected: at least one recent heartbeat
 */
export async function GET() {
  const checks: Record<string, HealthCheck> = {};

  // Check 1: Stuck jobs (RUNNING but all sims done)
  try {
    const activeJobs = await jobStore.listActiveJobs();
    const stuckJobs: string[] = [];

    for (const job of activeJobs) {
      if (isJobStuck(job)) {
        stuckJobs.push(job.id);
      }
    }

    checks.stuckJobs = {
      ok: stuckJobs.length === 0,
      detail: stuckJobs.length === 0
        ? `${activeJobs.length} active job(s), none stuck`
        : `${stuckJobs.length} stuck job(s)`,
    };
  } catch (err) {
    checks.stuckJobs = { ok: false, detail: `Error checking jobs: ${err instanceof Error ? err.message : 'unknown'}` };
  }

  // Check 2: Ratings populated
  try {
    const store = getRatingStore();
    const leaderboard = await store.getLeaderboard({ limit: 1 });
    checks.ratings = {
      ok: leaderboard.length > 0,
      detail: leaderboard.length > 0 ? 'Leaderboard has entries' : 'Leaderboard is empty',
    };
  } catch (err) {
    checks.ratings = { ok: false, detail: `Error checking ratings: ${err instanceof Error ? err.message : 'unknown'}` };
  }

  // Check 3: Worker connected
  try {
    const workers = await workerStore.getActiveWorkers();
    checks.worker = {
      ok: workers.length > 0,
      detail: workers.length > 0
        ? `${workers.length} active worker(s)`
        : 'No active workers',
    };
  } catch (err) {
    checks.worker = { ok: false, detail: `Error checking workers: ${err instanceof Error ? err.message : 'unknown'}` };
  }

  const allOk = Object.values(checks).every(c => c.ok);

  return NextResponse.json({
    status: allOk ? 'ok' : 'degraded',
    checks,
  });
}
