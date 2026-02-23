import { NextRequest, NextResponse } from 'next/server';
import { unauthorizedResponse, isWorkerRequest } from '@/lib/auth';
import * as jobStore from '@/lib/job-store-factory';
import { updateJobProgress, updateSimProgress, deleteJobProgress } from '@/lib/rtdb';
import { GAMES_PER_CONTAINER, type SimulationState } from '@/lib/types';

interface RouteParams {
  params: Promise<{ id: string; simId: string }>;
}

const VALID_STATES: SimulationState[] = ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'];

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
      return NextResponse.json({ error: 'Job ID and simulation ID are required' }, { status: 400 });
    }

    const body = await request.json();
    const { state, workerId, workerName, durationMs, errorMessage, winner, winningTurn, winners, winningTurns } = body;

    // Validate state if provided
    if (state !== undefined && !VALID_STATES.includes(state)) {
      return NextResponse.json(
        { error: `Invalid state. Must be one of: ${VALID_STATES.join(', ')}` },
        { status: 400 }
      );
    }

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

    // Guard: reject any state transition if the sim is already in a terminal state.
    // This prevents stale Pub/Sub redeliveries from regressing COMPLETED→RUNNING.
    if (state !== undefined) {
      const currentSim = await jobStore.getSimulationStatus(id, simId);
      if (currentSim && (currentSim.state === 'COMPLETED' || currentSim.state === 'CANCELLED')) {
        return NextResponse.json({ updated: false, reason: 'terminal_state' });
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
    updateSimProgress(id, simId, update).catch(() => {});

    // Auto-detect job lifecycle transitions
    if (state === 'RUNNING') {
      const job = await jobStore.getJob(id);
      if (job?.status === 'QUEUED') {
        await jobStore.setJobStartedAt(id, workerId, workerName);
        await jobStore.updateJobStatus(id, 'RUNNING');
        // Fire-and-forget RTDB write for job status transition
        updateJobProgress(id, {
          status: 'RUNNING',
          startedAt: new Date().toISOString(),
          workerName: workerName ?? null,
        }).catch(() => {});
      }
    }

    // Check if all sims are done → trigger aggregation.
    // Uses atomic counter (O(1)) instead of full sim subcollection scan (O(N)).
    if (transitioned && (state === 'COMPLETED' || state === 'CANCELLED')) {
      const { completedSimCount, totalSimCount } = await jobStore.incrementCompletedSimCount(id);

      // Fire-and-forget RTDB progress update
      // Estimate gamesCompleted from completedCount (not exact for CANCELLED, but close enough for UI)
      const gamesCompleted = completedSimCount * GAMES_PER_CONTAINER;
      updateJobProgress(id, { completedCount: completedSimCount, gamesCompleted }).catch(() => {});

      if (completedSimCount >= totalSimCount && totalSimCount > 0) {
        // Update RTDB before aggregation (frontend sees COMPLETED immediately)
        updateJobProgress(id, {
          status: 'COMPLETED',
          completedAt: new Date().toISOString(),
        }).catch(() => {});

        // Run aggregation in background — don't block the response
        jobStore.aggregateJobResults(id).catch(err => {
          console.error(`[Aggregation] Failed for job ${id}:`, err);
        });
      }
    }

    return NextResponse.json({ updated: true });
  } catch (error) {
    console.error('PATCH /api/jobs/[id]/simulations/[simId] error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update simulation' },
      { status: 500 }
    );
  }
}
