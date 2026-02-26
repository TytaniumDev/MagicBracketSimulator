import type { JobResponse, JobResults } from '@shared/types/job';
import type { SimulationStatus } from '@shared/types/simulation';
import type { WorkerInfo } from '@shared/types/worker';

// ---------------------------------------------------------------------------
// Default deck names used across all fixtures
// ---------------------------------------------------------------------------

export const DEFAULT_DECK_NAMES = [
  'Atraxa, Grand Unifier',
  'Korvold, Fae-Cursed King',
  'Yuriko, the Tiger\'s Shadow',
  'Tymna // Kraum',
];

// ---------------------------------------------------------------------------
// Job factory
// ---------------------------------------------------------------------------

export function makeJob(overrides: Partial<JobResponse> = {}): JobResponse {
  return {
    id: 'job-abc-123',
    name: 'Test Simulation',
    deckNames: [...DEFAULT_DECK_NAMES],
    status: 'COMPLETED',
    simulations: 20,
    gamesCompleted: 20,
    parallelism: 4,
    createdAt: '2025-02-20T12:00:00.000Z',
    startedAt: '2025-02-20T12:00:05.000Z',
    completedAt: '2025-02-20T12:05:00.000Z',
    durationMs: 295_000,
    retryCount: 0,
    results: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Results factory
// ---------------------------------------------------------------------------

export function makeResults(overrides: Partial<JobResults> = {}): JobResults {
  return {
    wins: {
      [DEFAULT_DECK_NAMES[0]]: 8,
      [DEFAULT_DECK_NAMES[1]]: 5,
      [DEFAULT_DECK_NAMES[2]]: 4,
      [DEFAULT_DECK_NAMES[3]]: 3,
    },
    avgWinTurn: {
      [DEFAULT_DECK_NAMES[0]]: 9.2,
      [DEFAULT_DECK_NAMES[1]]: 11.4,
      [DEFAULT_DECK_NAMES[2]]: 8.5,
      [DEFAULT_DECK_NAMES[3]]: 12.1,
    },
    gamesPlayed: 20,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Simulation factory
// ---------------------------------------------------------------------------

export function makeSim(overrides: Partial<SimulationStatus> = {}): SimulationStatus {
  return {
    simId: 'sim_000',
    index: 0,
    state: 'COMPLETED',
    ...overrides,
  };
}

/**
 * Generate an array of simulation statuses for a batch.
 * Each sim gets a sequential index and simId.
 */
export function makeSimulations(
  count: number,
  overrides: Partial<SimulationStatus> | ((index: number) => Partial<SimulationStatus>) = {},
): SimulationStatus[] {
  return Array.from({ length: count }, (_, i) => {
    const perSim = typeof overrides === 'function' ? overrides(i) : overrides;
    return makeSim({
      simId: `sim_${String(i).padStart(3, '0')}`,
      index: i,
      ...perSim,
    });
  });
}

// ---------------------------------------------------------------------------
// Worker factory
// ---------------------------------------------------------------------------

export function makeWorker(overrides: Partial<WorkerInfo> = {}): WorkerInfo {
  return {
    workerId: 'worker-1',
    workerName: 'gcp-worker-alpha',
    status: 'busy',
    capacity: 4,
    activeSimulations: 2,
    uptimeMs: 3_600_000,
    lastHeartbeat: '2025-02-20T12:05:00.000Z',
    ...overrides,
  };
}
