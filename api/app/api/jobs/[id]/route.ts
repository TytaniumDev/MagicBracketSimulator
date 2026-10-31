import { NextRequest, NextResponse } from 'next/server';
import { verifyAllowedUser, verifyAdmin, unauthorizedResponse, forbiddenResponse } from '@/lib/auth';
import * as jobStore from '@/lib/job-store-factory';
import { deleteJobCompletely } from '@/lib/job-delete';
import { resolveJobDecks } from '@/lib/job-decks';
import { GAMES_PER_CONTAINER, type DeckSlot } from '@/lib/types';
import { seatNames, type JobResponse } from '@shared/types/job';
import { errorResponse, notFoundResponse, badRequestResponse } from '@/lib/api-response';
import * as Sentry from '@sentry/nextjs';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** The `?view=worker` response: what a desktop worker needs to run a sim. */
interface WorkerJobResponse extends JobResponse {
  /** Games each sim plays in one Forge run. */
  gamesPerSim: number;
  decks?: DeckSlot[];
}

async function jobToApiResponse(
  job: Awaited<ReturnType<typeof jobStore.getJob>>,
  isWorker: boolean
): Promise<JobResponse | WorkerJobResponse | null> {
  if (!job) return null;
  const start = job.startedAt?.getTime() ?? job.createdAt.getTime();
  const end = job.completedAt?.getTime();
  const durationMs = end != null ? end - start : null;

  // Derive gamesCompleted from atomic counters (O(1) — no subcollection reads)
  const gamesCompleted = (job.completedSimCount != null && job.completedSimCount > 0)
    ? job.completedSimCount * GAMES_PER_CONTAINER
    : (job.gamesCompleted ?? 0);

  const response: JobResponse = {
    id: job.id,
    name: seatNames(job.seats).join(' vs '),
    seats: job.seats,
    status: job.status,
    simulations: job.simulations,
    gamesCompleted,
    parallelism: job.parallelism ?? 4,
    createdAt: job.createdAt.toISOString(),
    errorMessage: job.errorMessage,
    startedAt: job.startedAt?.toISOString(),
    completedAt: job.completedAt?.toISOString(),
    durationMs,
    workerId: job.workerId,
    workerName: job.workerName,
    claimedAt: job.claimedAt?.toISOString(),
    retryCount: job.retryCount ?? 0,
    results: job.results ?? null,
  };
  if (!isWorker) return response;

  // Workers also get each seat's decklist, and how many games each sim
  // plays: the API sizes sims by GAMES_PER_CONTAINER, so the worker must
  // run that many games per Forge run for the job to reach its game count.
  const decks = await resolveJobDecks(job);
  return { ...response, gamesPerSim: GAMES_PER_CONTAINER, ...(decks && { decks }) };
}

/**
 * GET /api/jobs/[id] - Get job details (allowed users).
 *
 * `?view=worker` adds the job's 4 decks with their .dck content
 * (see job-decks.ts) and `gamesPerSim`, the games each sim plays in one
 * Forge run. The desktop worker, which signs in as an allowed user, asks
 * for it to run the job's sims.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    await verifyAllowedUser(request);
  } catch {
    return unauthorizedResponse();
  }
  const isWorker = new URL(request.url).searchParams.get('view') === 'worker';

  try {
    const { id } = await params;
    if (!id) {
      return badRequestResponse('Job ID is required');
    }

    const job = await jobStore.getJob(id);
    if (!job) {
      return notFoundResponse('Job');
    }

    // Recovery of stuck jobs is handled out-of-band by the scheduled
    // stale-sweeper (/api/admin/sweep-stale-jobs via Cloud Scheduler, see
    // docs/STALE_SWEEPER.md). Keeping it out of the GET hot path: a frontend
    // poll against a 20-sim job used to fan out to ~22 Firestore reads per
    // call (job + active workers + every sim doc), which burned through the
    // 50k/day Firestore free tier in minutes of watching a running job.

    const response = await jobToApiResponse(job, isWorker);
    return NextResponse.json(response);
  } catch (error) {
    console.error('GET /api/jobs/[id] error:', error);
    Sentry.captureException(error, { tags: { component: 'api-route', route: 'GET /api/jobs/[id]' } });
    return errorResponse(error instanceof Error ? error.message : 'Failed to get job', 500);
  }
}

/**
 * DELETE /api/jobs/[id] - Delete a job (admin only)
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    await verifyAdmin(request);
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('Admin access required')) {
      return forbiddenResponse('Admin access required');
    }
    return unauthorizedResponse();
  }

  try {
    const { id } = await params;
    if (!id) {
      return badRequestResponse('Job ID is required');
    }

    if (!(await deleteJobCompletely(id))) {
      return notFoundResponse('Job');
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('DELETE /api/jobs/[id] error:', error);
    Sentry.captureException(error, { tags: { component: 'api-route', route: 'DELETE /api/jobs/[id]' } });
    return errorResponse(error instanceof Error ? error.message : 'Failed to delete job', 500);
  }
}
