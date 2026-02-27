import { NextRequest, NextResponse } from 'next/server';
import { unauthorizedResponse, isWorkerRequest } from '@/lib/auth';
import * as jobStore from '@/lib/job-store-factory';
import { updateJobProgress, updateSimProgress } from '@/lib/rtdb';
import { GAMES_PER_CONTAINER } from '@/lib/types';
import { parseBody, updateSimulationSchema } from '@/lib/validation';
import { canSimTransition, isTerminalSimState } from '@shared/types/state-machine';
import * as Sentry from '@sentry/nextjs';
import { errorResponse, badRequestResponse } from '@/lib/api-response';

interface RouteParams {
  params: Promise<{ id: string; simId: string }>;
}

/**
 * PATCH /api/jobs/[id]/simulations/[simId] — Update a single simulation's status.
 * Called by the worker to report per-simulation progress.
 * Body: Partial<SimulationStatus> (state, workerId, durationMs, errorMessage, winner, winningTurn)
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  if (!isWorkerRequest(request)) {
    return unauthorizedResponse('Worker authentication required');
  }

  try {
    const { id, simId } = await params;
    if (!id || !simId) {
      return badRequestResponse('Job ID and simulation ID are required');
    }

    const body = await request.json();
    const parsed = parseBody(updateSimulationSchema, body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const { state, workerId, workerName, durationMs, errorMessage, winner, winningTurn, winners, winningTurns } = parsed.data;

    // Build update object, only including defined fields
    const update: Record<string, unknown> = {};
    if (state !== undefined) update.state = state;
    if (workerId !== undefined) update.workerId = workerId;
    if (workerName !== undefined) update.workerName = workerName;
    if (durationMs !== undefined) update.durationMs = durationMs;
    if (errorMessage !== undefined) update.errorMessage = errorMessage;
    if (winner !== undefined) update.winner = winner;
    if (winningTurn !== undefined) update.winningTurn = winningTurn;
    if (winners !== undefined) update.winners = winners;
    if (winningTurns !== undefined) update.winningTurns = winningTurns;

    // Guard: validate state transitions using the simulation state machine.
    // Rejects invalid transitions (e.g., COMPLETED→RUNNING from stale Pub/Sub redeliveries).
    //
    // NOTE: Returns 200 with { updated: false } instead of 409, intentionally.
    // The worker treats these as idempotent no-ops (Pub/Sub redelivery is expected),
    // whereas job PATCH returns 409 because invalid transitions there indicate a
    // real bug in the caller, not a retry scenario.
    if (state !== undefined) {
      const currentSim = await jobStore.getSimulationStatus(id, simId);
      if (currentSim) {
        // Explicit terminal check before canSimTransition: while canSimTransition
        // would also reject these (terminal states have no valid transitions), we
        // check separately to return a distinct 'terminal_state' reason code that
        // the worker uses to skip further processing for this simulation.
        if (isTerminalSimState(currentSim.state)) {
          return NextResponse.json({ updated: false, reason: 'terminal_state' });
        }
        if (!canSimTransition(currentSim.state, state)) {
          return NextResponse.json(
            { updated: false, reason: 'invalid_transition', from: currentSim.state, to: state },
          );
        }
      }
    }

    // Add timestamps based on state transition
    if (state === 'RUNNING') {
      update.startedAt = new Date().toISOString();
    } else if (state === 'COMPLETED' || state === 'FAILED' || state === 'CANCELLED') {
      update.completedAt = new Date().toISOString();
    }

    // For COMPLETED transitions, use conditional update to prevent races
    // when retried simulations report completion again.
    let transitioned = true;
    if (state === 'COMPLETED') {
      transitioned = await jobStore.conditionalUpdateSimulationStatus(
        id, simId, ['PENDING', 'RUNNING', 'FAILED'], update
      );
    } else {
      await jobStore.updateSimulationStatus(id, simId, update);
    }

    // Fire-and-forget RTDB write for simulation progress
    updateSimProgress(id, simId, update).catch(err => console.warn('[RTDB] updateSimProgress failed:', err instanceof Error ? err.message : err));

    // Auto-detect job lifecycle transitions
    if (state === 'RUNNING') {
      // Atomically transition QUEUED → RUNNING (prevents duplicate writes from concurrent sims)
      const transitioned = await jobStore.conditionalUpdateJobStatus(id, ['QUEUED'], 'RUNNING', { workerId, workerName });
      if (transitioned) {
        updateJobProgress(id, {
          status: 'RUNNING',
          startedAt: new Date().toISOString(),
          workerName: workerName ?? null,
        }).catch(err => console.warn('[RTDB] job RUNNING transition failed:', err instanceof Error ? err.message : err));
      }
    }

    // Check if all sims are done → trigger aggregation.
    // Uses atomic counter (O(1)) instead of full sim subcollection scan (O(N)).
    if (transitioned && (state === 'COMPLETED' || state === 'CANCELLED')) {
      const { completedSimCount, totalSimCount } = await jobStore.incrementCompletedSimCount(id);

      // Fire-and-forget RTDB progress update
      // Estimate gamesCompleted from completedCount (not exact for CANCELLED, but close enough for UI)
      const gamesCompleted = completedSimCount * GAMES_PER_CONTAINER;
      updateJobProgress(id, { completedCount: completedSimCount, gamesCompleted }).catch(err => console.warn('[RTDB] progress count update failed:', err instanceof Error ? err.message : err));

      if (completedSimCount >= totalSimCount && totalSimCount > 0) {
        // Set flag before fire-and-forget aggregation
        await jobStore.setNeedsAggregation(id, true);

        updateJobProgress(id, {
          status: 'COMPLETED',
          completedAt: new Date().toISOString(),
        }).catch(err => console.warn('[RTDB] job COMPLETED status update failed:', err instanceof Error ? err.message : err));

        jobStore.aggregateJobResults(id).catch(err => {
          console.error(`[Aggregation] Failed for job ${id}:`, err);
          Sentry.captureException(err, { tags: { component: 'sim-aggregation', jobId: id } });
        });
      }
    }

    return NextResponse.json({ updated: true });
  } catch (error) {
    console.error('PATCH /api/jobs/[id]/simulations/[simId] error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Failed to update simulation', 500);
  }
}
