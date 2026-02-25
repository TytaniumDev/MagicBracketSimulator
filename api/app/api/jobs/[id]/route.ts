import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyAdmin, unauthorizedResponse, forbiddenResponse, isWorkerRequest } from '@/lib/auth';
import * as jobStore from '@/lib/job-store-factory';
import { deleteJobArtifacts } from '@/lib/gcs-storage';
import { isGcpMode, getDeckById } from '@/lib/deck-store-factory';
import { GAMES_PER_CONTAINER, type JobStatus } from '@/lib/types';

interface RouteParams {
  params: Promise<{ id: string }>;
}

async function resolveDeckLinks(
  deckIds: string[],
  deckNames: string[]
): Promise<Record<string, string | null>> {
  const entries = await Promise.all(
    deckIds.map(async (id, i) => {
      try {
        const deck = await getDeckById(id);
        return [deckNames[i], deck?.link ?? null] as [string, string | null];
      } catch {
        return [deckNames[i], null] as [string, string | null];
      }
    })
  );
  return Object.fromEntries(entries);
}

async function jobToApiResponse(
  job: Awaited<ReturnType<typeof jobStore.getJob>>,
  isWorker: boolean
) {
  if (!job) return null;
  const deckNames = job.decks.map((d) => d.name);
  const start = job.startedAt?.getTime() ?? job.createdAt.getTime();
  const end = job.completedAt?.getTime();
  const durationMs = end != null ? end - start : null;

  // Derive gamesCompleted from atomic counters (O(1) — no subcollection reads)
  const gamesCompleted = (job.completedSimCount != null && job.completedSimCount > 0)
    ? job.completedSimCount * GAMES_PER_CONTAINER
    : (job.gamesCompleted ?? 0);

  const base = {
    id: job.id,
    name: deckNames.join(' vs '),
    deckNames,
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
  };
  // Worker needs decks and/or deckIds to run the job
  if (isWorker) {
    return {
      ...base,
      ...(job.decks.length === 4 && { decks: job.decks }),
      ...(job.deckIds && job.deckIds.length === 4 && { deckIds: job.deckIds }),
    };
  }

  // Resolve deck links for frontend consumers
  let deckLinks: Record<string, string | null> | undefined;
  if (job.deckIds && job.deckIds.length === 4) {
    deckLinks = await resolveDeckLinks(job.deckIds, deckNames);
  }

  return { ...base, ...(deckLinks && { deckLinks }) };
}

/**
 * GET /api/jobs/[id] - Get job details
 * Dual auth: workers authenticate via X-Worker-Secret, users via Firebase token.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const isWorker = isWorkerRequest(request);
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
      return NextResponse.json({ error: 'Job ID is required' }, { status: 400 });
    }

    let job = await jobStore.getJob(id);
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    // Attempt stale job recovery for RUNNING or stuck QUEUED jobs
    if (job.status === 'RUNNING' || job.status === 'QUEUED') {
      const recovered = await jobStore.recoverStaleJob(id);
      if (recovered) {
        job = await jobStore.getJob(id);
        if (!job) {
          return NextResponse.json({ error: 'Job not found' }, { status: 404 });
        }
      }
    }

    const response = await jobToApiResponse(job, isWorker);
    return NextResponse.json(response);
  } catch (error) {
    console.error('GET /api/jobs/[id] error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get job' },
      { status: 500 }
    );
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
      return NextResponse.json({ error: 'Job ID is required' }, { status: 400 });
    }

    const job = await jobStore.getJob(id);
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    // Cancel the job first if it's still active, so the worker can detect it
    if (job.status === 'QUEUED' || job.status === 'RUNNING') {
      await jobStore.cancelJob(id);
    }

    // Delete simulation subcollection first (Firestore doesn't cascade)
    await jobStore.deleteSimulations(id);
    await jobStore.deleteJob(id);

    if (isGcpMode()) {
      try {
        await deleteJobArtifacts(id);
      } catch (err) {
        console.warn('Failed to delete GCS artifacts:', err);
      }
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('DELETE /api/jobs/[id] error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete job' },
      { status: 500 }
    );
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
      return NextResponse.json({ error: 'Job ID is required' }, { status: 400 });
    }

    const body = await request.json();
    const { status, errorMessage, dockerRunDurationsMs, workerId, workerName } = body;

    const job = await jobStore.getJob(id);
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update job' },
      { status: 500 }
    );
  }
}
