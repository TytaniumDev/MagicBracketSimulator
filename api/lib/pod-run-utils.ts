/**
 * Convert stored pod runs to their API response shapes.
 */
import type { PodRunResponse, PodRunSummary } from '@shared/types/pod-run';
import type { PodRun } from './pod-run-store';

export function podRunToSummary(run: PodRun): PodRunSummary {
  return {
    id: run.id,
    deckNames: run.deckNames,
    podCount: run.jobIds.length,
    simulations: run.simulations,
    createdAt: run.createdAt.toISOString(),
  };
}

export function podRunToResponse(run: PodRun): PodRunResponse {
  return { ...podRunToSummary(run), deckIds: run.deckIds, jobIds: run.jobIds };
}
