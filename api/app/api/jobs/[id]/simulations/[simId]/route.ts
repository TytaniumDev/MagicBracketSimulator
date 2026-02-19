import { NextRequest, NextResponse } from 'next/server';
import { unauthorizedResponse, isWorkerRequest } from '@/lib/auth';
import * as jobStore from '@/lib/job-store-factory';
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

    // Add timestamps based on state transition
    if (state === 'RUNNING') {
      update.startedAt = new Date().toISOString();
    } else if (state === 'COMPLETED' || state === 'FAILED' || state === 'CANCELLED') {
      update.completedAt = new Date().toISOString();
    }

    await jobStore.updateSimulationStatus(id, simId, update);

    // Auto-detect job lifecycle transitions
    if (state === 'RUNNING') {
      const job = await jobStore.getJob(id);
      if (job?.status === 'QUEUED') {
        await jobStore.setJobStartedAt(id, workerId, workerName);
        await jobStore.updateJobStatus(id, 'RUNNING');
      }
    }

    if (state === 'COMPLETED') {
      await jobStore.incrementGamesCompleted(id, GAMES_PER_CONTAINER);
    }

    // Check if all sims are terminal → trigger aggregation (includes CANCELLED)
    if (state === 'COMPLETED' || state === 'FAILED' || state === 'CANCELLED') {
      const allSims = await jobStore.getSimulationStatuses(id);
      const allTerminal = allSims.every(s =>
        s.state === 'COMPLETED' || s.state === 'FAILED' || s.state === 'CANCELLED'
      );
      if (allTerminal) {
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
