import { NextRequest, NextResponse } from 'next/server';
import { isWorkerRequest } from '@/lib/auth';
import { getCoverageStore } from '@/lib/coverage-store-factory';
import { generateNextPod, hasActiveCoverageJob } from '@/lib/coverage-service';
import { resolveDeckIds } from '@/lib/deck-resolver';
import * as jobStore from '@/lib/job-store-factory';
import { isGcpMode } from '@/lib/job-store-factory';
import { GAMES_PER_CONTAINER } from '@/lib/types';
import { publishSimulationTasks } from '@/lib/pubsub';
import { pushToAllWorkers } from '@/lib/worker-push';
import { errorResponse } from '@/lib/api-response';

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

    const { decks, errors } = await resolveDeckIds(pod);
    if (errors.length > 0) {
      console.error(`[Coverage] Failed to resolve decks: ${errors.join(', ')}`);
      return NextResponse.json({ reason: 'deck-resolution-failed', errors });
    }

    const job = await jobStore.createJob(decks, COVERAGE_SIMULATIONS, {
      parallelism: COVERAGE_PARALLELISM,
      createdBy: 'coverage-system',
      deckIds: pod,
      source: 'coverage',
    });

    const containerCount = Math.ceil(COVERAGE_SIMULATIONS / GAMES_PER_CONTAINER);
    await jobStore.initializeSimulations(job.id, containerCount);

    if (isGcpMode()) {
      await publishSimulationTasks(job.id, containerCount).catch((err) =>
        console.error(`[Coverage] Failed to publish tasks for job ${job.id}:`, err)
      );
    } else {
      pushToAllWorkers('/notify', {}).catch((err) =>
        console.warn('[Coverage] Worker notify failed:', err instanceof Error ? err.message : err)
      );
    }

    const deckNames = job.decks.map((d) => d.name);
    console.log(`[Coverage] Created job ${job.id}: ${deckNames.join(' vs ')}`);

    return NextResponse.json({ id: job.id, deckNames, source: 'coverage' }, { status: 201 });
  } catch (error) {
    console.error('POST /api/coverage/next-job error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Failed to create coverage job', 500);
  }
}
