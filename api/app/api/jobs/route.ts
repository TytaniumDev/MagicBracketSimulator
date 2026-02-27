import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyAllowedUser, unauthorizedResponse } from '@/lib/auth';
import * as jobStore from '@/lib/job-store-factory';
import { resolveDeckIds } from '@/lib/deck-resolver';
import { publishSimulationTasks } from '@/lib/pubsub';
import { GAMES_PER_CONTAINER } from '@/lib/types';
import { parseBody, createJobSchema } from '@/lib/validation';
import type { JobSummary } from '@shared/types/job';
import { isGcpMode } from '@/lib/job-store-factory';
import { checkRateLimit } from '@/lib/rate-limiter';
import { pushToAllWorkers } from '@/lib/worker-push';
import { updateJobProgress } from '@/lib/rtdb';
import { scheduleRecoveryCheck } from '@/lib/cloud-tasks';
import * as Sentry from '@sentry/nextjs';
import { isJobStuck } from '@/lib/job-utils';

// In-process dedup: track job IDs that already have recovery aggregation in flight.
// Prevents redundant concurrent aggregation runs when Browse page is refreshed.
const pendingRecoveryAggregations = new Set<string>();

/**
 * Convert Job to API summary format.
 * Accepts pre-computed gamesCompleted derived from simulation statuses.
 *
 * Derives effective status from sim counts: if all sims are done but
 * Firestore status is still RUNNING (aggregation failed), show COMPLETED
 * to the Browse page and trigger background recovery aggregation.
 */
function jobToSummary(job: Awaited<ReturnType<typeof jobStore.getJob>>, gamesCompleted: number): JobSummary | null {
  if (!job) return null;
  const deckNames = job.decks.map((d) => d.name);
  const start = job.startedAt?.getTime() ?? job.createdAt.getTime();
  const end = job.completedAt?.getTime();
  const durationMs = end != null ? end - start : null;

  // Derive effective status: if all sims done but Firestore still says RUNNING,
  // show COMPLETED and trigger recovery aggregation in the background.
  let effectiveStatus = job.status;
  if (isJobStuck(job)) {
    effectiveStatus = 'COMPLETED';
    // Trigger background recovery aggregation for stuck job (deduped per job ID)
    if (!pendingRecoveryAggregations.has(job.id)) {
      pendingRecoveryAggregations.add(job.id);
      jobStore.aggregateJobResults(job.id)
        .catch((err) => {
          console.error(`[Browse Recovery] Aggregation failed for stuck job ${job.id}:`, err);
          Sentry.captureException(err, { tags: { component: 'browse-recovery', jobId: job.id } });
        })
        .finally(() => {
          pendingRecoveryAggregations.delete(job.id);
        });
    }
  }

  return {
    id: job.id,
    name: deckNames.join(' vs '),
    deckNames,
    status: effectiveStatus,
    simulations: job.simulations,
    gamesCompleted,
    createdAt: job.createdAt.toISOString(),
    durationMs,
    parallelism: job.parallelism,
    errorMessage: job.errorMessage,
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
    await verifyAuth(request);
  } catch {
    return unauthorizedResponse();
  }

  try {
    const jobs = await jobStore.listJobs();
    // Derive gamesCompleted from atomic counters (O(1) — no subcollection reads)
    const summaries = jobs
      .filter((j): j is NonNullable<typeof j> => j !== null)
      .map((j) => {
        const gamesCompleted = (j.completedSimCount != null && j.completedSimCount > 0)
          ? j.completedSimCount * GAMES_PER_CONTAINER
          : (j.gamesCompleted ?? 0);
        return jobToSummary(j, gamesCompleted);
      })
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
    user = await verifyAllowedUser(request);
  } catch {
    return unauthorizedResponse();
  }

  try {
    const body = await request.json();
    const parsed = parseBody(createJobSchema, body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const { deckIds, simulations, parallelism, idempotencyKey } = parsed.data;

    // Rate limiting
    const rateCheck = await checkRateLimit(user.uid, simulations);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: rateCheck.reason },
        { status: 429 }
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
      parallelism,
      createdBy: user.uid,
      deckIds,
    });

    // Each container runs GAMES_PER_CONTAINER games, so we need fewer containers
    const containerCount = Math.ceil(simulations / GAMES_PER_CONTAINER);

    // Initialize per-simulation tracking and publish messages (1 sim record = 1 container)
    await jobStore.initializeSimulations(job.id, containerCount);

    // Fire-and-forget: write initial progress to RTDB for real-time frontend streaming
    const deckNames = job.decks.map((d) => d.name);
    updateJobProgress(job.id, {
      status: 'QUEUED',
      totalCount: containerCount,
      completedCount: 0,
      gamesCompleted: 0,
      errorMessage: null,
      startedAt: null,
      completedAt: null,
      workerName: null,
      deckNames,
    }).catch(err => console.warn('[RTDB] Initial progress write failed:', err instanceof Error ? err.message : err));

    if (isGcpMode()) {
      try {
        await publishSimulationTasks(job.id, containerCount);
      } catch (pubsubError) {
        // Log but don't fail — the job is already persisted in Firestore.
        // Recovery Cloud Task will re-publish messages if needed.
        console.error(`Failed to publish simulation tasks for job ${job.id}:`, pubsubError);
      }
      // Schedule a recovery check at T+10min in case something goes wrong
      scheduleRecoveryCheck(job.id, 600).catch(err => console.warn('[Recovery] Failed to schedule check:', err instanceof Error ? err.message : err));
    } else {
      // Local mode: notify workers that a new job is available (best-effort)
      pushToAllWorkers('/notify', {}).catch(err => console.warn('[Worker Push] Notify failed:', err instanceof Error ? err.message : err));
    }

    return NextResponse.json(
      { id: job.id, deckNames },
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
