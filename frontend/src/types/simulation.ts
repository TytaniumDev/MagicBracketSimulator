/** Number of games each simulation container runs sequentially. Must match api/lib/types.ts. */
export const GAMES_PER_CONTAINER = 4;

/** Lifecycle state for an individual simulation within a job. */
export type SimulationState = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

/** Status tracking for a single simulation within a job. */
export interface SimulationStatus {
  simId: string;
  index: number;
  state: SimulationState;
  workerId?: string;
  workerName?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  errorMessage?: string;
  winner?: string;
  winningTurn?: number;
  winners?: string[];
  winningTurns?: number[];
}
