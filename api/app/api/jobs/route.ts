import { NextRequest, NextResponse } from 'next/server';
import { optionalAuth, verifyAuth, unauthorizedResponse } from '@/lib/auth';
import * as jobStore from '@/lib/job-store-factory';
import { resolveDeckIds } from '@/lib/deck-resolver';
import { publishJobCreated } from '@/lib/pubsub';
import { SIMULATIONS_MIN, SIMULATIONS_MAX, PARALLELISM_MIN, PARALLELISM_MAX, type CreateJobRequest } from '@/lib/types';
import { isGcpMode } from '@/lib/job-store-factory';

/**
 * Convert Job to API summary format
 */
function jobToSummary(job: Awaited<ReturnType<typeof jobStore.getJob>>) {
  if (!job) return null;
  const deckNames = job.decks.map((d) => d.name);
  const start = job.startedAt?.getTime() ?? job.createdAt.getTime();
  const end = job.completedAt?.getTime();
  const durationMs = end != null ? end - start : null;

  return {
    id: job.id,
    name: deckNames.join(' vs '),
    deckNames,
    status: job.status,
    simulations: job.simulations,
    gamesCompleted: job.gamesCompleted ?? 0,
    createdAt: job.createdAt.toISOString(),
    hasResult: !!job.resultJson,
    durationMs,
    parallelism: job.parallelism,
    errorMessage: job.errorMessage,
    resultJson: job.resultJson,
    startedAt: job.startedAt?.toISOString(),
    completedAt: job.completedAt?.toISOString(),
    dockerRunDurationsMs: job.dockerRunDurationsMs,
  };
}

/**
 * GET /api/jobs - List jobs
 */
export async function GET(request: NextRequest) {
  try {
    const user = await optionalAuth(request);
    const userId = user?.uid;

    const jobs = await jobStore.listJobs(userId ?? undefined);
    const summaries = jobs
      .map((j) => jobToSummary(j))
      .filter((s): s is NonNullable<typeof s> => s !== null);

    return NextResponse.json({ jobs: summaries });
  } catch (error) {
    console.error('GET /api/jobs error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to list jobs' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/jobs - Create a new job
 */
export async function POST(request: NextRequest) {
  let user;
  try {
    user = await verifyAuth(request);
  } catch {
    return unauthorizedResponse();
  }

  try {
    const body = (await request.json()) as CreateJobRequest;
    const { deckIds, simulations, parallelism, idempotencyKey } = body;

    if (!Array.isArray(deckIds) || deckIds.length !== 4) {
      return NextResponse.json(
        { error: 'Exactly 4 deckIds are required' },
        { status: 400 }
      );
    }

    if (typeof simulations !== 'number' || simulations < SIMULATIONS_MIN || simulations > SIMULATIONS_MAX) {
      return NextResponse.json(
        { error: `simulations must be between ${SIMULATIONS_MIN} and ${SIMULATIONS_MAX}` },
        { status: 400 }
      );
    }

    const par = parallelism ?? 4;
    if (typeof par !== 'number' || par < PARALLELISM_MIN || par > PARALLELISM_MAX) {
      return NextResponse.json(
        { error: `parallelism must be between ${PARALLELISM_MIN} and ${PARALLELISM_MAX}` },
        { status: 400 }
      );
    }

    const { decks, errors } = await resolveDeckIds(deckIds);
    if (errors.length > 0) {
      return NextResponse.json(
        { error: `Invalid deck IDs: ${errors.join(', ')}` },
        { status: 400 }
      );
    }

    const job = await jobStore.createJob(decks, simulations, {
      idempotencyKey,
      parallelism: par,
      createdBy: user.uid,
      deckIds,
    });

    if (isGcpMode()) {
      await publishJobCreated(job.id);
    }

    return NextResponse.json(
      { id: job.id, deckNames: job.decks.map((d) => d.name) },
      { status: 201 }
    );
  } catch (error) {
    console.error('POST /api/jobs error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create job' },
      { status: 500 }
    );
  }
}
