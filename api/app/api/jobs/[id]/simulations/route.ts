import { NextRequest, NextResponse } from 'next/server';
import { unauthorizedResponse, isWorkerRequest } from '@/lib/auth';
import * as jobStore from '@/lib/job-store-factory';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/jobs/[id]/simulations — Get all simulation statuses for a job.
 * Used by the frontend to render per-simulation progress.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Job ID is required' }, { status: 400 });
    }

    const job = await jobStore.getJob(id);
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    const simulations = await jobStore.getSimulationStatuses(id);
    return NextResponse.json({ simulations });
  } catch (error) {
    console.error('GET /api/jobs/[id]/simulations error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get simulations' },
      { status: 500 }
    );
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
      return NextResponse.json({ error: 'Job ID is required' }, { status: 400 });
    }

    const body = await request.json();
    const { count } = body;

    if (typeof count !== 'number' || count < 1 || count > 200) {
      return NextResponse.json(
        { error: 'count must be a number between 1 and 200' },
        { status: 400 }
      );
    }

    const job = await jobStore.getJob(id);
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    await jobStore.initializeSimulations(id, count);
    return NextResponse.json({ initialized: count }, { status: 201 });
  } catch (error) {
    console.error('POST /api/jobs/[id]/simulations error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to initialize simulations' },
      { status: 500 }
    );
  }
}
