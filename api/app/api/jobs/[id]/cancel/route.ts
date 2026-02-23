import { NextRequest, NextResponse } from 'next/server';
import { verifyAllowedUser, unauthorizedResponse } from '@/lib/auth';
import * as jobStore from '@/lib/job-store-factory';
import { pushToAllWorkers } from '@/lib/worker-push';
import { updateJobProgress, deleteJobProgress } from '@/lib/rtdb';
import { cancelRecoveryCheck } from '@/lib/cloud-tasks';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/jobs/[id]/cancel - Cancel a QUEUED or RUNNING job
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    await verifyAllowedUser(request);
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

    if (job.status === 'COMPLETED' || job.status === 'FAILED' || job.status === 'CANCELLED') {
      return NextResponse.json(
        { error: `Job is already ${job.status}` },
        { status: 409 }
      );
    }

    await jobStore.cancelJob(id);

    // Cancel scheduled recovery task (fire-and-forget)
    cancelRecoveryCheck(id).catch(() => {});

    // Update RTDB then clean up (fire-and-forget)
    updateJobProgress(id, { status: 'CANCELLED', completedAt: new Date().toISOString() })
      .then(() => deleteJobProgress(id))
      .catch(() => {});

    // Push cancel to all active workers (best-effort)
    pushToAllWorkers('/cancel', { jobId: id }).catch(() => {});

    // Trigger log aggregation so structured.json gets created from completed sims
    jobStore.aggregateJobResults(id).catch(err => {
      console.error(`[Aggregation] Failed for cancelled job ${id}:`, err);
    });

    return NextResponse.json({ id, status: 'CANCELLED' });
  } catch (error) {
    console.error('POST /api/jobs/[id]/cancel error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to cancel job' },
      { status: 500 }
    );
  }
}
