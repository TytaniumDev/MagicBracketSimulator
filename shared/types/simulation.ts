/**
 * Shared types for per-simulation tracking.
 *
 * These represent the JSON shapes sent over HTTP/SSE between worker → API
 * and API → frontend. Both api/ and frontend/ import from here.
 */

// ---------------------------------------------------------------------------
// Simulation lifecycle
// ---------------------------------------------------------------------------

export type SimulationState = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

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
  /** Winner of this game (single-game containers, legacy) */
  winner?: string;
  /** Turn the game ended on (single-game containers, legacy) */
  winningTurn?: number;
  /** Winners of each game in this container batch (multi-game containers) */
  winners?: string[];
  /** Winning turns for each game in this container batch (multi-game containers) */
  winningTurns?: number[];
}
