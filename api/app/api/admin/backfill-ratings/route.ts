import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin, unauthorizedResponse } from '@/lib/auth';
import * as jobStore from '@/lib/job-store-factory';
import { getRatingStore } from '@/lib/rating-store-factory';
import { isJobStuck } from '@/lib/job-utils';
import * as Sentry from '@sentry/nextjs';
import { errorResponse } from '@/lib/api-response';

/**
 * POST /api/admin/backfill-ratings — Re-run TrueSkill ratings for completed jobs.
 *
 * Admin-only. For each COMPLETED job (or stuck RUNNING job with all sims done):
 * 1. Check if match results already exist (idempotent skip).
 * 2. If not rated, re-run processJobForRatings.
 * 3. If stuck RUNNING, run aggregateJobResults first.
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
    const store = getRatingStore();
    const jobs = await jobStore.listJobs();

    for (const job of jobs) {
      if (!job) continue;

      const isCompleted = job.status === 'COMPLETED';
      const isStuckRunning = isJobStuck(job);

      if (!isCompleted && !isStuckRunning) continue;
      if (!Array.isArray(job.deckIds) || job.deckIds.length !== 4) continue;

      try {
        // Idempotency: skip if already rated
        if (await store.hasMatchResultsForJob(job.id)) {
          skipped.push(job.id);
          continue;
        }

        // If stuck RUNNING, aggregate first to ingest logs and set status
        if (isStuckRunning) {
          await jobStore.aggregateJobResults(job.id);
        }

        // Run TrueSkill rating
        const { getStructuredLogs } = await import('@/lib/log-store');
        const structuredData = await getStructuredLogs(job.id);

        if (structuredData?.games?.length) {
          const { processJobForRatings } = await import('@/lib/trueskill-service');
          await processJobForRatings(job.id, job.deckIds, structuredData.games);
          processed.push(job.id);
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
