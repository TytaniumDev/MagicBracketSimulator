import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, unauthorizedResponse, isWorkerRequest } from '@/lib/auth';
import * as jobStore from '@/lib/job-store-factory';
import { errorResponse, notFoundResponse, badRequestResponse } from '@/lib/api-response';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/jobs/[id]/simulations — Get all simulation statuses for a job.
 * Used by the frontend to render per-simulation progress.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    await verifyAuth(request);
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

    const simulations = await jobStore.getSimulationStatuses(id);
    return NextResponse.json({ simulations });
  } catch (error) {
    console.error('GET /api/jobs/[id]/simulations error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Failed to get simulations', 500);
  }
}

/**
 * POST /api/jobs/[id]/simulations — Initialize simulation tracking for a job.
 * Called by the worker when it starts processing a job.
 * Body: { count: number }
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  if (!isWorkerRequest(request)) {
    return unauthorizedResponse('Worker authentication required');
  }

  try {
    const { id } = await params;
    if (!id) {
      return badRequestResponse('Job ID is required');
    }

    const body = await request.json();
    const { count } = body;

    if (typeof count !== 'number' || count < 1 || count > 200) {
      return badRequestResponse('count must be a number between 1 and 200');
    }

    const job = await jobStore.getJob(id);
    if (!job) {
      return notFoundResponse('Job');
    }

    await jobStore.initializeSimulations(id, count);
    return NextResponse.json({ initialized: count }, { status: 201 });
  } catch (error) {
    console.error('POST /api/jobs/[id]/simulations error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Failed to initialize simulations', 500);
  }
}
