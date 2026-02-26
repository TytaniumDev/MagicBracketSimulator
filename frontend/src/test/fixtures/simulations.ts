import type { SimulationStatus } from '@shared/types/simulation';
import { makeSim } from './factory';

/**
 * Mixed state simulations for grid tests:
 * 2 COMPLETED (worker-1), 1 RUNNING (worker-1), 1 FAILED (worker-2), 1 PENDING (no worker)
 */
export const mixedStateSimulations: SimulationStatus[] = [
  makeSim({
    simId: 'sim_000', index: 0, state: 'COMPLETED',
    workerId: 'worker-1', workerName: 'gcp-worker-alpha',
    winners: ['Deck A', 'Deck B', 'Deck C', 'Deck D'],
    winningTurns: [8, 12, 10, 9],
    durationMs: 45_000,
  }),
  makeSim({
    simId: 'sim_001', index: 1, state: 'COMPLETED',
    workerId: 'worker-1', workerName: 'gcp-worker-alpha',
    winners: ['Deck A', 'Deck A', 'Deck B', 'Deck C'],
    winningTurns: [7, 11, 14, 8],
    durationMs: 48_000,
  }),
  makeSim({
    simId: 'sim_002', index: 2, state: 'RUNNING',
    workerId: 'worker-1', workerName: 'gcp-worker-alpha',
  }),
  makeSim({
    simId: 'sim_003', index: 3, state: 'FAILED',
    workerId: 'worker-2', workerName: 'gcp-worker-beta',
    errorMessage: 'Forge process exited with code 137',
    durationMs: 30_000,
  }),
  makeSim({
    simId: 'sim_004', index: 4, state: 'PENDING',
  }),
];

/**
 * All 5 containers completed on the same worker.
 */
export const allCompletedSimulations: SimulationStatus[] = Array.from({ length: 5 }, (_, i) =>
  makeSim({
    simId: `sim_${String(i).padStart(3, '0')}`,
    index: i,
    state: 'COMPLETED',
    workerId: 'worker-1',
    workerName: 'gcp-worker-alpha',
    winners: ['Deck A', 'Deck B', 'Deck C', 'Deck D'],
    winningTurns: [8, 12, 10, 9],
    durationMs: 45_000 + i * 1000,
  }),
);

/**
 * All 5 containers pending with no worker assigned.
 */
export const allPendingSimulations: SimulationStatus[] = Array.from({ length: 5 }, (_, i) =>
  makeSim({
    simId: `sim_${String(i).padStart(3, '0')}`,
    index: i,
    state: 'PENDING',
  }),
);
