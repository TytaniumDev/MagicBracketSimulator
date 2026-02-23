import { NextRequest, NextResponse } from 'next/server';
import { isWorkerRequest } from '@/lib/auth';
import * as jobStore from '@/lib/job-store-factory';
import { scheduleRecoveryCheck } from '@/lib/cloud-tasks';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/jobs/[id]/recover — One-shot recovery check for a job.
 *
 * Called by Cloud Tasks after a scheduled delay. Authenticates via
 * X-Worker-Secret header (same as worker requests).
 *
 * Logic:
 * 1. If job is terminal → no-op (task should have been cancelled but wasn't)
 * 2. If job is still active → run recoverStaleJob
 * 3. If job is still active after recovery → reschedule in 5 min
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  // Authenticate: accept Cloud Tasks OIDC or worker secret
  if (!isWorkerRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Job ID is required' }, { status: 400 });
    }

    const job = await jobStore.getJob(id);
    if (!job) {
      return NextResponse.json({ status: 'not_found' });
    }

    // No-op for terminal jobs
    if (job.status === 'COMPLETED' || job.status === 'FAILED' || job.status === 'CANCELLED') {
      return NextResponse.json({ status: 'terminal', jobStatus: job.status });
    }

    // Attempt recovery
    const recovered = await jobStore.recoverStaleJob(id);

    // Re-check job status after recovery
    const updatedJob = await jobStore.getJob(id);
    const stillActive = updatedJob && updatedJob.status !== 'COMPLETED' && updatedJob.status !== 'FAILED' && updatedJob.status !== 'CANCELLED';

    // If still active, reschedule for another check in 5 minutes
    if (stillActive) {
      scheduleRecoveryCheck(id, 300).catch(() => {});
    }

    return NextResponse.json({ status: 'ok', recovered, stillActive });
  } catch (error) {
    console.error('POST /api/jobs/[id]/recover error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Recovery failed' },
      { status: 500 }
    );
  }
}
