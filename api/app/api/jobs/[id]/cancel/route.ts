import { NextRequest, NextResponse } from 'next/server';
import { verifyAllowedUser, unauthorizedResponse } from '@/lib/auth';
import * as jobStore from '@/lib/job-store-factory';
import { pushToAllWorkers } from '@/lib/worker-push';
import { cancelRecoveryCheck } from '@/lib/cloud-tasks';
import { isTerminalJobState } from '@shared/types/state-machine';
import { errorResponse, notFoundResponse, badRequestResponse } from '@/lib/api-response';

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
      return badRequestResponse('Job ID is required');
    }

    const job = await jobStore.getJob(id);
    if (!job) {
      return notFoundResponse('Job');
    }

    if (isTerminalJobState(job.status)) {
      return errorResponse(`Job is already ${job.status}`, 409);
    }

    await jobStore.cancelJob(id);

    // Cancel scheduled recovery task (fire-and-forget)
    cancelRecoveryCheck(id).catch(err => console.warn('[Recovery] Cancel check failed:', err instanceof Error ? err.message : err));

    // Push cancel to all active workers (best-effort)
    pushToAllWorkers('/cancel', { jobId: id }).catch(err => console.warn('[Worker Push] Cancel push failed:', err instanceof Error ? err.message : err));

    // Trigger log aggregation so structured.json gets created from completed sims
    jobStore.aggregateJobResults(id).catch(err => {
      console.error(`[Aggregation] Failed for cancelled job ${id}:`, err);
    });

    return NextResponse.json({ id, status: 'CANCELLED' });
  } catch (error) {
    console.error('POST /api/jobs/[id]/cancel error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Failed to cancel job', 500);
  }
}
