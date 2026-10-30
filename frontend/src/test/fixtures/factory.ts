import type { JobResponse, JobResults, JobSeat } from '@shared/types/job';
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

const DEFAULT_DECK_IDS = ['deck-atraxa', 'deck-korvold', 'deck-yuriko', 'deck-tymna-kraum'];

/** Seats for `names` (the default decks by default), with no link or colors. */
export function makeSeats(names: readonly string[] = DEFAULT_DECK_NAMES): JobSeat[] {
  return names.map((name, i) => ({
    deckId: DEFAULT_DECK_IDS[i] ?? `deck-${i}`,
    name,
    link: null,
    colorIdentity: [],
  }));
}

// ---------------------------------------------------------------------------
// Job factory
// ---------------------------------------------------------------------------

export function makeJob(overrides: Partial<JobResponse> = {}): JobResponse {
  return {
    id: 'job-abc-123',
    name: 'Test Simulation',
    seats: makeSeats(),
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
    gamesPlayed: 20,
    seats: [
      { wins: 8, avgWinTurn: 9.2 },
      { wins: 5, avgWinTurn: 11.4 },
      { wins: 4, avgWinTurn: 8.5 },
      { wins: 3, avgWinTurn: 12.1 },
    ],
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
