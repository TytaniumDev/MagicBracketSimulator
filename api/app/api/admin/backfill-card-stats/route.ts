import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin, unauthorizedResponse } from '@/lib/auth';
import * as jobStore from '@/lib/job-store-factory';
import * as Sentry from '@sentry/nextjs';
import { errorResponse } from '@/lib/api-response';
import type { ParsedCardStatsJob } from '@/lib/card-impact/service';
import type { GameCardSummary } from '@/lib/card-impact/parse';
import { seatNames } from '@shared/types/job';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

function parsePageSize(value: string | null): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? Math.min(n, MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;
}

/**
 * POST /api/admin/backfill-card-stats — Count completed jobs that finished
 * before card impact stats existed.
 *
 * Admin-only. Walks completed jobs `?limit=` at a time (default 50, max
 * 200), newest first, and adds their raw logs to their decks' card
 * counters with one write per deck per page. Pass the response's
 * `nextCursor` back as `?cursor=` to continue through older jobs. Safe to
 * re-run: the store skips jobs it already counted. Run it again after
 * bumping CARD_STATS_VERSION, which discards counters from the old parser.
 */
export async function POST(request: NextRequest) {
  try {
    await verifyAdmin(request);
  } catch (err) {
    console.error('[BackfillCardStats] Admin verification failed:', err);
    return unauthorizedResponse('Admin access required');
  }

  const skipped: string[] = [];
  const errors: { jobId: string; error: string }[] = [];

  try {
    const params = new URL(request.url).searchParams;
    const cursor = params.get('cursor') ?? undefined;
    const limit = parsePageSize(params.get('limit'));
    const { jobs, nextCursor } = await jobStore.listJobs({ limit, cursor });
    const { forEachRawGame } = await import('@/lib/log-store');
    const { parseGameCards } = await import('@/lib/card-impact/parse');
    const { processJobsForCardStats } = await import('@/lib/card-impact/service');

    // Parse each game as it is read, so only a few raw log files are held at
    // a time. A page of raw logs can exceed the instance's memory.
    const toCount: ParsedCardStatsJob[] = [];
    for (const job of jobs) {
      if (!job || job.status !== 'COMPLETED') continue;
      if (job.seats.length !== 4) continue;

      try {
        const games: GameCardSummary[] = [];
        await forEachRawGame(job.id, (game) => games.push(parseGameCards(game)));
        if (games.length === 0) {
          skipped.push(job.id);
          continue;
        }
        toCount.push({ jobId: job.id, deckIds: job.seats.map((s) => s.deckId), deckNames: seatNames(job.seats), games });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown error';
        errors.push({ jobId: job.id, error: message });
        Sentry.captureException(err, { tags: { component: 'backfill-card-stats', jobId: job.id } });
      }
    }

    // One write per deck for the whole page, to stay well inside Firestore's free tier.
    await processJobsForCardStats(toCount);
    const processed = toCount.map((j) => j.jobId);

    return NextResponse.json({ processed: processed.length, skipped: skipped.length, errors, nextCursor: nextCursor ?? null });
  } catch (err) {
    console.error('[BackfillCardStats] Fatal error:', err);
    Sentry.captureException(err, { tags: { component: 'backfill-card-stats' } });
    return errorResponse(err instanceof Error ? err.message : 'Backfill failed', 500);
  }
}
