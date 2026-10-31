import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin, unauthorizedResponse } from '@/lib/auth';
import * as jobStore from '@/lib/job-store-factory';
import { isJobStuck } from '@/lib/job-utils';
import * as Sentry from '@sentry/nextjs';
import { errorResponse } from '@/lib/api-response';

/**
 * POST /api/admin/backfill-ratings — Re-run per-deck win stats for completed jobs.
 *
 * Admin-only. For each COMPLETED job (or stuck RUNNING job with all sims done):
 * 1. If stuck RUNNING, run aggregateJobResults first.
 * 2. Re-run processJobForRatings, which skips jobs already rated.
 */
export async function POST(request: NextRequest) {
  try {
    await verifyAdmin(request);
  } catch (err) {
    console.error('[Backfill] Admin verification failed:', err);
    return unauthorizedResponse('Admin access required');
  }

  const processed: string[] = [];
  const skipped: string[] = [];
  const errors: { jobId: string; error: string }[] = [];

  try {
    // Backfill walks whichever jobs are in the current page cap. For full
    // history rebuilds, call the endpoint repeatedly with `?cursor=…` once
    // the paginated contract is exposed here (see docs/BACKFILL.md).
    const { jobs } = await jobStore.listJobs({ limit: 200 });

    for (const job of jobs) {
      if (!job) continue;

      const isCompleted = job.status === 'COMPLETED';
      const isStuckRunning = isJobStuck(job);

      if (!isCompleted && !isStuckRunning) continue;
      if (job.seats.length !== 4) continue;

      try {
        // If stuck RUNNING, aggregate first to ingest logs and set status
        if (isStuckRunning) {
          await jobStore.aggregateJobResults(job.id);
        }

        // Update per-deck win/game counters and pair game counts
        const { getGameIndex } = await import('@/lib/log-store');
        const gameIndex = await getGameIndex(job.id, job.seats.map((s) => s.name));

        if (gameIndex?.games.length) {
          const { processJobForRatings } = await import('@/lib/trueskill-service');
          // Idempotent: a job already rated is skipped by the store.
          const applied = await processJobForRatings(job.id, job.seats, gameIndex.games);
          (applied ? processed : skipped).push(job.id);
        } else {
          skipped.push(job.id);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown error';
        errors.push({ jobId: job.id, error: message });
        Sentry.captureException(err, { tags: { component: 'backfill-ratings', jobId: job.id } });
      }
    }

    return NextResponse.json({
      processed: processed.length,
      skipped: skipped.length,
      errors,
      processedJobIds: processed,
    });
  } catch (err) {
    console.error('[Backfill] Fatal error:', err);
    Sentry.captureException(err, { tags: { component: 'backfill-ratings' } });
    return errorResponse(err instanceof Error ? err.message : 'Backfill failed', 500);
  }
}
