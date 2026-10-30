import { NextRequest, NextResponse } from 'next/server';
import { isWorkerRequest } from '@/lib/auth';
import { getCoverageStore } from '@/lib/coverage-store-factory';
import { generateNextPod, hasActiveCoverageJob } from '@/lib/coverage-service';
import { resolveJobSeats } from '@/lib/job-seats';
import * as jobStore from '@/lib/job-store-factory';
import { GAMES_PER_CONTAINER } from '@/lib/types';
import { pushToAllWorkers } from '@/lib/worker-push';
import { errorResponse } from '@/lib/api-response';
import * as Sentry from '@sentry/nextjs';
import { seatNames } from '@shared/types/job';

const COVERAGE_SIMULATIONS = 100;
const COVERAGE_PARALLELISM = 1;

/**
 * POST /api/coverage/next-job — worker requests next coverage job
 * Auth: worker secret only
 */
export async function POST(request: NextRequest) {
  if (!isWorkerRequest(request)) {
    return errorResponse('Unauthorized', 401);
  }

  try {
    const config = await (await getCoverageStore()).getConfig();
    if (!config.enabled) {
      return NextResponse.json({ reason: 'disabled' });
    }

    // Prevent race condition: only one coverage job at a time
    if (await hasActiveCoverageJob()) {
      return NextResponse.json({ reason: 'active-job-exists' });
    }

    const pod = await generateNextPod(config.targetGamesPerPair);
    if (!pod) {
      return NextResponse.json({ reason: 'all-pairs-covered' });
    }

    const { seats, errors } = await resolveJobSeats(pod);
    if (errors.length > 0) {
      console.error(`[Coverage] Failed to resolve decks: ${errors.join(', ')}`);
      return NextResponse.json({ reason: 'deck-resolution-failed', errors });
    }

    const job = await jobStore.createJob(seats, COVERAGE_SIMULATIONS, {
      parallelism: COVERAGE_PARALLELISM,
      createdBy: 'coverage-system',
      source: 'coverage',
    });

    const containerCount = Math.ceil(COVERAGE_SIMULATIONS / GAMES_PER_CONTAINER);
    await jobStore.initializeSimulations(job.id, containerCount);

    // Workers pick up sims via /api/jobs/claim-sim; push-notify for low-latency wake-up.
    pushToAllWorkers('/notify', {}).catch((err) => {
      console.warn('[Coverage] Worker notify failed:', err instanceof Error ? err.message : err);
      Sentry.captureException(err, { tags: { component: 'worker-push' } });
    });

    const deckNames = seatNames(job.seats);
    console.log(`[Coverage] Created job ${job.id}: ${deckNames.join(' vs ')}`);

    return NextResponse.json({ id: job.id, deckNames, source: 'coverage' }, { status: 201 });
  } catch (error) {
    console.error('POST /api/coverage/next-job error:', error);
    Sentry.captureException(error, { tags: { component: 'api-route', route: 'POST /api/coverage/next-job' } });
    return errorResponse(error instanceof Error ? error.message : 'Failed to create coverage job', 500);
  }
}
