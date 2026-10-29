import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin, unauthorizedResponse } from '@/lib/auth';
import * as jobStore from '@/lib/job-store-factory';
import * as Sentry from '@sentry/nextjs';
import { errorResponse } from '@/lib/api-response';

/**
 * POST /api/admin/backfill-card-stats — Count completed jobs that finished
 * before card impact stats existed.
 *
 * Admin-only. Walks completed jobs 200 at a time, newest first, and adds
 * each one's raw logs to its decks' card counters. Pass the response's
 * `nextCursor` back as `?cursor=` to continue through older jobs. Safe to
 * re-run: the store skips jobs it already counted.
 */
export async function POST(request: NextRequest) {
  try {
    await verifyAdmin(request);
  } catch (err) {
    console.error('[BackfillCardStats] Admin verification failed:', err);
    return unauthorizedResponse('Admin access required');
  }

  const processed: string[] = [];
  const skipped: string[] = [];
  const errors: { jobId: string; error: string }[] = [];

  try {
    const cursor = new URL(request.url).searchParams.get('cursor') ?? undefined;
    const { jobs, nextCursor } = await jobStore.listJobs({ limit: 200, cursor });
    const { getRawLogs } = await import('@/lib/log-store');
    const { processJobForCardStats } = await import('@/lib/card-impact/service');

    for (const job of jobs) {
      if (!job || job.status !== 'COMPLETED') continue;
      if (!Array.isArray(job.deckIds) || job.deckIds.length !== 4) continue;

      try {
        const rawLogs = await getRawLogs(job.id);
        if (!rawLogs?.length) {
          skipped.push(job.id);
          continue;
        }
        await processJobForCardStats(job.id, job.deckIds, job.decks.map((d) => d.name), rawLogs);
        processed.push(job.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown error';
        errors.push({ jobId: job.id, error: message });
        Sentry.captureException(err, { tags: { component: 'backfill-card-stats', jobId: job.id } });
      }
    }

    return NextResponse.json({ processed: processed.length, skipped: skipped.length, errors, nextCursor: nextCursor ?? null });
  } catch (err) {
    console.error('[BackfillCardStats] Fatal error:', err);
    Sentry.captureException(err, { tags: { component: 'backfill-card-stats' } });
    return errorResponse(err instanceof Error ? err.message : 'Backfill failed', 500);
  }
}
