import { NextRequest, NextResponse } from 'next/server';
import { verifyAllowedUser, unauthorizedResponse, AuthUser } from '@/lib/auth';
import * as jobStore from '@/lib/job-store-factory';
import { resolveJobSeats } from '@/lib/job-seats';
import { parseBody, createJobSchema } from '@/lib/validation';
import { seatNames, type JobSummary } from '@shared/types/job';
import { queueJob } from '@/lib/queue-job';
import * as Sentry from '@sentry/nextjs';
import { isJobStuck } from '@/lib/job-utils';
import { errorResponse, badRequestResponse } from '@/lib/api-response';

// In-process dedup: track job IDs that already have recovery aggregation in flight.
// Prevents redundant concurrent aggregation runs when Browse page is refreshed.
const pendingRecoveryAggregations = new Set<string>();

/**
 * Convert Job to API summary format.
 * Accepts pre-computed gamesCompleted derived from simulation statuses.
 *
 * Derives effective status from sim counts: if all sims are done but
 * Firestore status is still RUNNING (aggregation failed), show COMPLETED
 * to the Browse page and trigger background recovery aggregation.
 */
function jobToSummary(job: Awaited<ReturnType<typeof jobStore.getJob>>, gamesCompleted: number): JobSummary | null {
  if (!job) return null;
  const start = job.startedAt?.getTime() ?? job.createdAt.getTime();
  const end = job.completedAt?.getTime();
  const durationMs = end != null ? end - start : null;

  // Derive effective status: if all sims done but Firestore still says RUNNING,
  // show COMPLETED and trigger recovery aggregation in the background.
  let effectiveStatus = job.status;
  if (isJobStuck(job)) {
    effectiveStatus = 'COMPLETED';
    // Trigger background recovery aggregation for stuck job (deduped per job ID)
    if (!pendingRecoveryAggregations.has(job.id)) {
      pendingRecoveryAggregations.add(job.id);
      jobStore.aggregateJobResults(job.id)
        .catch((err) => {
          console.error(`[Browse Recovery] Aggregation failed for stuck job ${job.id}:`, err);
          Sentry.captureException(err, { tags: { component: 'browse-recovery', jobId: job.id } });
        })
        .finally(() => {
          pendingRecoveryAggregations.delete(job.id);
        });
    }
  }

  return {
    id: job.id,
    name: seatNames(job.seats).join(' vs '),
    seats: job.seats,
    status: effectiveStatus,
    simulations: job.simulations,
    gamesCompleted,
    createdAt: job.createdAt.toISOString(),
    durationMs,
    parallelism: job.parallelism,
    errorMessage: job.errorMessage,
    startedAt: job.startedAt?.toISOString(),
    completedAt: job.completedAt?.toISOString(),
  };
}

/**
 * GET /api/jobs - List jobs (paginated)
 * Query params: ?limit=N (default 100, max 200), ?cursor=<opaque>
 * Returns: { jobs: JobSummary[], nextCursor: string | null }
 */
export async function GET(request: NextRequest): Promise<NextResponse | Response> {
  try {
    await verifyAllowedUser(request);
  } catch {
    return unauthorizedResponse();
  }

  try {
    const url = new URL(request.url);
    const limitParam = url.searchParams.get('limit');
    const cursorParam = url.searchParams.get('cursor');
    const limit = limitParam ? parseInt(limitParam, 10) : undefined;
    if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
      return badRequestResponse('limit must be a positive integer');
    }

    const { jobs, nextCursor } = await jobStore.listJobs({
      limit,
      cursor: cursorParam ?? undefined,
    });

    const summaries = jobs
      .filter((j): j is NonNullable<typeof j> => j !== null)
      .map((j) => jobToSummary(j, j.gamesCompleted ?? 0))
      .filter((s): s is NonNullable<typeof s> => s !== null);

    return NextResponse.json({ jobs: summaries, nextCursor });
  } catch (error) {
    console.error('GET /api/jobs error:', error);
    Sentry.captureException(error, { tags: { component: 'api-route', route: 'GET /api/jobs' } });
    return errorResponse(error instanceof Error ? error.message : 'Failed to list jobs', 500);
  }
}

/**
 * POST /api/jobs - Create a new job
 */
export async function POST(request: NextRequest): Promise<NextResponse | Response> {
  let user: AuthUser;
  try {
    user = await verifyAllowedUser(request);
  } catch {
    return unauthorizedResponse();
  }

  try {
    const body = await request.json();
    const parsed = parseBody(createJobSchema, body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const { deckIds, simulations, parallelism, idempotencyKey } = parsed.data;

    // No per-user job or game limits: only allowlisted users reach this
    // point (verifyAllowedUser), and pod runs queue many jobs at once.

    // Warn about duplicate decks (not an error, but produces meaningless results)
    const uniqueDeckIds = new Set(deckIds);
    const hasDuplicates = uniqueDeckIds.size < deckIds.length;

    const { seats, errors } = await resolveJobSeats(deckIds);
    if (errors.length > 0) {
      return badRequestResponse(`Invalid deck IDs: ${errors.join(', ')}`);
    }

    const job = await queueJob(seats, simulations, {
      idempotencyKey,
      parallelism,
      createdBy: user.uid,
    });

    return NextResponse.json(
      { id: job.id, deckNames: seatNames(job.seats), ...(hasDuplicates && { warning: 'Duplicate decks detected. Results may not be meaningful.' }) },
      { status: 201 }
    );
  } catch (error) {
    console.error('POST /api/jobs error:', error);
    Sentry.captureException(error, { tags: { component: 'api-route', route: 'POST /api/jobs' } });
    return errorResponse(error instanceof Error ? error.message : 'Failed to create job', 500);
  }
}
