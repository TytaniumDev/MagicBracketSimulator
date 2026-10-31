import { NextRequest, NextResponse } from 'next/server';
import { isInternalRequest } from '@/lib/auth';
import * as jobStore from '@/lib/job-store-factory';
import { scheduleRecoveryCheck } from '@/lib/cloud-tasks';
import { isTerminalJobState } from '@shared/types/state-machine';
import { errorResponse, badRequestResponse } from '@/lib/api-response';
import * as Sentry from '@sentry/nextjs';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/jobs/[id]/recover — One-shot recovery check for a job.
 *
 * Called by Cloud Tasks after a scheduled delay. Authenticates via
 * X-Worker-Secret header (see isInternalRequest in lib/auth.ts).
 *
 * Logic:
 * 1. If job is terminal → no-op (tasks are never deleted when a job ends)
 * 2. If job is still active → run recoverStaleJob
 * 3. If job is still active after recovery → reschedule in 5 min
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  // Authenticate: accept Cloud Tasks OIDC or worker secret
  if (!isInternalRequest(request)) {
    return errorResponse('Unauthorized', 401);
  }

  try {
    const { id } = await params;
    if (!id) {
      return badRequestResponse('Job ID is required');
    }

    const job = await jobStore.getJob(id);
    if (!job) {
      return NextResponse.json({ status: 'not_found' });
    }

    // No-op for terminal jobs
    if (isTerminalJobState(job.status)) {
      return NextResponse.json({ status: 'terminal', jobStatus: job.status });
    }

    // Attempt recovery
    const recovered = await jobStore.recoverStaleJob(id);

    // Re-check job status after recovery
    const updatedJob = await jobStore.getJob(id);
    const stillActive = updatedJob && !isTerminalJobState(updatedJob.status);

    // If still active, reschedule for another check in 5 minutes
    if (stillActive) {
      scheduleRecoveryCheck(id, 300).catch(err => {
        console.warn('[Recovery] Reschedule failed:', err instanceof Error ? err.message : err);
        Sentry.captureException(err, { tags: { component: 'cloud-tasks', jobId: id } });
      });
    }

    return NextResponse.json({ status: 'ok', recovered, stillActive });
  } catch (error) {
    console.error('POST /api/jobs/[id]/recover error:', error);
    Sentry.captureException(error, { tags: { component: 'api-route', route: 'POST /api/jobs/[id]/recover' } });
    return errorResponse(error instanceof Error ? error.message : 'Recovery failed', 500);
  }
}
