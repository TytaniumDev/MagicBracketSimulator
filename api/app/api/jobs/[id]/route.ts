import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, optionalAuth, unauthorizedResponse, isWorkerRequest } from '@/lib/auth';
import * as jobStore from '@/lib/job-store-factory';
import { deleteJobArtifacts } from '@/lib/gcs-storage';
import { isGcpMode } from '@/lib/job-store-factory';
import type { JobStatus } from '@/lib/types';

interface RouteParams {
  params: Promise<{ id: string }>;
}

function jobToApiResponse(
  job: Awaited<ReturnType<typeof jobStore.getJob>>,
  isWorker: boolean
) {
  if (!job) return null;
  const deckNames = job.decks.map((d) => d.name);
  const start = job.startedAt?.getTime() ?? job.createdAt.getTime();
  const end = job.completedAt?.getTime();
  const durationMs = end != null ? end - start : null;

  const base = {
    id: job.id,
    name: deckNames.join(' vs '),
    deckNames,
    status: job.status,
    simulations: job.simulations,
    gamesCompleted: job.gamesCompleted ?? 0,
    parallelism: job.parallelism ?? 4,
    createdAt: job.createdAt.toISOString(),
    errorMessage: job.errorMessage,
    resultJson: job.resultJson,
    startedAt: job.startedAt?.toISOString(),
    completedAt: job.completedAt?.toISOString(),
    durationMs,
    dockerRunDurationsMs: job.dockerRunDurationsMs,
  };
  // Worker needs decks and/or deckIds to run the job
  if (isWorker) {
    return {
      ...base,
      ...(job.decks.length === 4 && { decks: job.decks }),
      ...(job.deckIds && job.deckIds.length === 4 && { deckIds: job.deckIds }),
    };
  }
  return base;
}

/**
 * Allow request if user is authenticated OR worker secret is valid
 */
async function allowJobReadOrUpdate(request: NextRequest): Promise<boolean> {
  if (isWorkerRequest(request)) return true;
  const user = await optionalAuth(request);
  return user !== null;
}

/**
 * GET /api/jobs/[id] - Get job details
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const allowed = await allowJobReadOrUpdate(request);
    if (!allowed) {
      return unauthorizedResponse();
    }

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Job ID is required' }, { status: 400 });
    }

    const job = await jobStore.getJob(id);
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    const isWorker = isWorkerRequest(request);
    const response = jobToApiResponse(job, isWorker);
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
 * DELETE /api/jobs/[id] - Delete a job
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    await verifyAuth(request);
  } catch {
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
 * Used by simulation-worker and misc-runner
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const allowed = await allowJobReadOrUpdate(request);
  if (!allowed) {
    return unauthorizedResponse();
  }

  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Job ID is required' }, { status: 400 });
    }

    const body = await request.json();
    const { status, gamesCompleted, errorMessage, dockerRunDurationsMs } = body;

    const job = await jobStore.getJob(id);
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    if (status === 'RUNNING') {
      await jobStore.setJobStartedAt(id);
    } else if (status === 'COMPLETED') {
      await jobStore.setJobCompleted(id, dockerRunDurationsMs);
    } else if (status === 'FAILED') {
      await jobStore.setJobFailed(id, errorMessage ?? 'Unknown error', dockerRunDurationsMs);
    } else if (typeof status === 'string') {
      await jobStore.updateJobStatus(id, status as JobStatus);
    }

    if (gamesCompleted !== undefined && typeof gamesCompleted === 'number') {
      await jobStore.updateJobProgress(id, gamesCompleted);
    }

    const updated = await jobStore.getJob(id);
    const isWorker = isWorkerRequest(request);
    const response = jobToApiResponse(updated, isWorker);
    return NextResponse.json(response);
  } catch (error) {
    console.error('PATCH /api/jobs/[id] error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update job' },
      { status: 500 }
    );
  }
}
