import type { JobResponse } from '@shared/types/job';
import type { SimulationStatus } from '@shared/types/simulation';
import { makeJob, makeResults, makeSimulations, DEFAULT_DECK_NAMES } from './factory';

// ---------------------------------------------------------------------------
// A named scenario bundles a job with its simulations for easy test setup.
// ---------------------------------------------------------------------------

export interface JobScenario {
  description: string;
  job: JobResponse;
  simulations: SimulationStatus[];
}

// ---------------------------------------------------------------------------
// Completed scenarios
// ---------------------------------------------------------------------------

export const completedWithResults: JobScenario = {
  description: 'Fully completed with server-aggregated results, deck links, and color identity',
  job: makeJob({
    status: 'COMPLETED',
    results: makeResults(),
    deckLinks: {
      [DEFAULT_DECK_NAMES[0]]: 'https://www.moxfield.com/decks/atraxa',
      [DEFAULT_DECK_NAMES[1]]: 'https://www.moxfield.com/decks/korvold',
      [DEFAULT_DECK_NAMES[2]]: null,
      [DEFAULT_DECK_NAMES[3]]: null,
    },
    colorIdentity: {
      [DEFAULT_DECK_NAMES[0]]: ['W', 'U', 'B', 'G'],
      [DEFAULT_DECK_NAMES[1]]: ['B', 'R', 'G'],
      [DEFAULT_DECK_NAMES[2]]: ['U', 'B'],
      [DEFAULT_DECK_NAMES[3]]: ['W', 'U', 'B', 'R'],
    },
  }),
  simulations: makeSimulations(5, (i) => ({
    state: 'COMPLETED',
    workerId: 'worker-1',
    workerName: 'gcp-worker-alpha',
    winners: [
      DEFAULT_DECK_NAMES[i % 4],
      DEFAULT_DECK_NAMES[(i + 1) % 4],
      DEFAULT_DECK_NAMES[(i + 2) % 4],
      DEFAULT_DECK_NAMES[(i + 3) % 4],
    ],
    winningTurns: [8, 12, 10, 9],
    durationMs: 45_000 + i * 1000,
  })),
};

export const completedWithoutResults: JobScenario = {
  description: 'Completed but results not yet aggregated (fallback to sim data)',
  job: makeJob({
    status: 'COMPLETED',
    results: null,
  }),
  simulations: makeSimulations(5, (i) => ({
    state: 'COMPLETED',
    workerId: 'worker-1',
    winners: [
      DEFAULT_DECK_NAMES[0],
      DEFAULT_DECK_NAMES[1],
      DEFAULT_DECK_NAMES[i % 4],
      DEFAULT_DECK_NAMES[3],
    ],
    winningTurns: [8, 12, 10, 9],
  })),
};

// ---------------------------------------------------------------------------
// Running scenarios
// ---------------------------------------------------------------------------

export const runningHalfway: JobScenario = {
  description: '~50% progress, mix of COMPLETED/RUNNING/PENDING sims',
  job: makeJob({
    status: 'RUNNING',
    gamesCompleted: 8,
    completedAt: undefined,
    durationMs: null,
  }),
  simulations: makeSimulations(5, (i) => {
    if (i < 2) return {
      state: 'COMPLETED',
      workerId: 'worker-1',
      winners: [DEFAULT_DECK_NAMES[0], DEFAULT_DECK_NAMES[1], DEFAULT_DECK_NAMES[2], DEFAULT_DECK_NAMES[3]],
      winningTurns: [8, 12, 10, 9],
      durationMs: 45_000,
    };
    if (i === 2) return { state: 'RUNNING', workerId: 'worker-1' };
    return { state: 'PENDING' };
  }),
};

export const runningJustStarted: JobScenario = {
  description: '0% progress, all sims PENDING',
  job: makeJob({
    status: 'RUNNING',
    gamesCompleted: 0,
    completedAt: undefined,
    durationMs: null,
  }),
  simulations: makeSimulations(5, () => ({ state: 'PENDING' })),
};

// ---------------------------------------------------------------------------
// Queued scenarios
// ---------------------------------------------------------------------------

export const queuedFirstInLine: JobScenario = {
  description: 'Position 0, workers online',
  job: makeJob({
    status: 'QUEUED',
    gamesCompleted: 0,
    startedAt: undefined,
    completedAt: undefined,
    durationMs: null,
    queuePosition: 0,
    workers: { online: 2, idle: 1, busy: 1 },
  }),
  simulations: [],
};

export const queuedNoWorkers: JobScenario = {
  description: 'Queued with zero workers',
  job: makeJob({
    status: 'QUEUED',
    gamesCompleted: 0,
    startedAt: undefined,
    completedAt: undefined,
    durationMs: null,
    queuePosition: 1,
    workers: { online: 0, idle: 0, busy: 0 },
  }),
  simulations: [],
};

export const queuedRetrying: JobScenario = {
  description: 'Queued with retryCount > 0',
  job: makeJob({
    status: 'QUEUED',
    gamesCompleted: 0,
    startedAt: undefined,
    completedAt: undefined,
    durationMs: null,
    retryCount: 2,
    queuePosition: 0,
    workers: { online: 1, idle: 0, busy: 1 },
  }),
  simulations: [],
};

// ---------------------------------------------------------------------------
// Failed / Cancelled scenarios
// ---------------------------------------------------------------------------

export const failedWithError: JobScenario = {
  description: 'Error message, partial sim completion',
  job: makeJob({
    status: 'FAILED',
    gamesCompleted: 8,
    errorMessage: 'Worker crashed: OOM killed during simulation',
    durationMs: 120_000,
  }),
  simulations: makeSimulations(5, (i) => {
    if (i < 2) return {
      state: 'COMPLETED',
      workerId: 'worker-1',
      winners: [DEFAULT_DECK_NAMES[0], DEFAULT_DECK_NAMES[1], DEFAULT_DECK_NAMES[2], DEFAULT_DECK_NAMES[3]],
      winningTurns: [8, 12, 10, 9],
    };
    if (i === 2) return {
      state: 'FAILED',
      workerId: 'worker-1',
      errorMessage: 'OOM killed',
    };
    return { state: 'CANCELLED' };
  }),
};

export const cancelled: JobScenario = {
  description: 'Partially completed then cancelled',
  job: makeJob({
    status: 'CANCELLED',
    gamesCompleted: 8,
    durationMs: 90_000,
  }),
  simulations: makeSimulations(5, (i) => {
    if (i < 2) return {
      state: 'COMPLETED',
      workerId: 'worker-1',
      winners: [DEFAULT_DECK_NAMES[0], DEFAULT_DECK_NAMES[1], DEFAULT_DECK_NAMES[2], DEFAULT_DECK_NAMES[3]],
      winningTurns: [8, 12, 10, 9],
    };
    return { state: 'CANCELLED' };
  }),
};
