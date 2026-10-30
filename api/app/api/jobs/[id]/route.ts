import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyAdmin, unauthorizedResponse, forbiddenResponse, isWorkerRequest } from '@/lib/auth';
import * as jobStore from '@/lib/job-store-factory';
import { deleteJobCompletely } from '@/lib/job-delete';
import { resolveJobDecks } from '@/lib/job-decks';
import { isWorkerOrAllowlistedUser } from '@/lib/worker-auth';
import { GAMES_PER_CONTAINER, type JobStatus } from '@/lib/types';
import { parseBody, updateJobSchema } from '@/lib/validation';
import { seatNames, type JobResponse } from '@shared/types/job';
import { canJobTransition } from '@shared/types/state-machine';
import { errorResponse, notFoundResponse, badRequestResponse } from '@/lib/api-response';
import * as Sentry from '@sentry/nextjs';

interface RouteParams {
  params: Promise<{ id: string }>;
}

async function jobToApiResponse(
  job: Awaited<ReturnType<typeof jobStore.getJob>>,
  isWorker: boolean
): Promise<JobResponse | null> {
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
    dockerRunDurationsMs: job.dockerRunDurationsMs,
    workerId: job.workerId,
    workerName: job.workerName,
    claimedAt: job.claimedAt?.toISOString(),
    retryCount: job.retryCount ?? 0,
    results: job.results ?? null,
  };
  if (!isWorker) return response;

  // Workers also get each seat's decklist to run the job
  const decks = await resolveJobDecks(job);
  return { ...response, ...(decks && { decks }) };
}

/**
 * GET /api/jobs/[id] - Get job details
 * Dual auth: workers authenticate via X-Worker-Secret, users via Firebase token.
 *
 * Workers get the worker view: the job's 4 decks with their .dck content
 * (see job-decks.ts). The desktop worker, which signs in as an allowlisted
 * user, asks for it with `?view=worker`.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const wantsWorkerView = new URL(request.url).searchParams.get('view') === 'worker';
  const isWorker = isWorkerRequest(request) || (wantsWorkerView && (await isWorkerOrAllowlistedUser(request)));
  if (!isWorker) {
    try {
      await verifyAuth(request);
    } catch {
      return unauthorizedResponse();
    }
  }

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

/**
 * PATCH /api/jobs/[id] - Update job (status, gamesCompleted, errorMessage, dockerRunDurationsMs)
 * Used by worker and misc-runner
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  if (!isWorkerRequest(request)) {
    return unauthorizedResponse('Worker authentication required');
  }

  try {
    const { id } = await params;
    if (!id) {
      return badRequestResponse('Job ID is required');
    }

    const body = await request.json();
    const parsed = parseBody(updateJobSchema, body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const { status, errorMessage, dockerRunDurationsMs, workerId, workerName } = parsed.data;

    const job = await jobStore.getJob(id);
    if (!job) {
      return notFoundResponse('Job');
    }

    // Validate job state transition using the state machine
    if (typeof status === 'string' && !canJobTransition(job.status, status as JobStatus)) {
      return errorResponse(`Invalid status transition: ${job.status} → ${status}`, 409);
    }

    if (status === 'RUNNING') {
      await jobStore.setJobStartedAt(id, workerId, workerName);
    } else if (status === 'COMPLETED') {
      await jobStore.setJobCompleted(id, dockerRunDurationsMs);
    } else if (status === 'FAILED') {
      await jobStore.setJobFailed(id, errorMessage ?? 'Unknown error', dockerRunDurationsMs);
    } else if (typeof status === 'string') {
      await jobStore.updateJobStatus(id, status as JobStatus);
    }

    const updated = await jobStore.getJob(id);
    const isWorker = isWorkerRequest(request);
    const response = await jobToApiResponse(updated, isWorker);
    return NextResponse.json(response);
  } catch (error) {
    console.error('PATCH /api/jobs/[id] error:', error);
    Sentry.captureException(error, { tags: { component: 'api-route', route: 'PATCH /api/jobs/[id]' } });
    return errorResponse(error instanceof Error ? error.message : 'Failed to update job', 500);
  }
}
