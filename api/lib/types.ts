/**
 * API type definitions.
 *
 * SHARED TYPES: Re-exported from @shared/types/ so both API and frontend
 * import from the same source of truth. Any field change becomes a compile
 * error in both projects.
 *
 * INTERNAL TYPES: API-only types (Job, DeckSlot, CreateJobRequest, Precon,
 * DeckRating, MatchResult) that use server-side constructs like Date objects
 * and are never serialized directly to the frontend.
 */

// ---------------------------------------------------------------------------
// Re-exports from shared types (single source of truth)
// ---------------------------------------------------------------------------

export type { JobStatus } from '@shared/types/job';
export type { JobResults } from '@shared/types/job';
export { GAMES_PER_CONTAINER } from '@shared/types/job';

export type { SimulationState, SimulationStatus } from '@shared/types/simulation';

export type {
  EventType,
  GameEvent,
  TurnManaInfo,
  DeckTurnInfo,
  CondensedGame,
  DeckAction,
  DeckTurnActions,
  DeckHistory,
  StructuredGame,
} from '@shared/types/log';

export type { WorkerInfo } from '@shared/types/worker';

// ---------------------------------------------------------------------------
// API-internal types (not shared with frontend)
// ---------------------------------------------------------------------------

// These imports duplicate the re-exports above, but are necessary:
// `export type { X }` re-exports make X available to consumers of this module,
// while `import type { X }` below makes X available within THIS file for use
// in the interface definitions that follow (e.g., Job.status, Job.results).
import type { JobStatus } from '@shared/types/job';
import type { JobResults } from '@shared/types/job';

export interface DeckSlot {
  name: string;
  dck: string;
}

/**
 * Internal Job representation. Uses Date objects for timestamps
 * (the shared JobResponse type uses ISO strings for serialization).
 */
export interface Job {
  id: string;
  decks: DeckSlot[]; // Always length 4 (for backward compat; may be empty when deckIds used)
  deckIds?: string[]; // Length 4 when set; worker uses cache + deck API when present
  status: JobStatus;
  simulations: number;
  parallelism?: number;
  createdAt: Date;
  errorMessage?: string;
  gamesCompleted?: number;
  startedAt?: Date;
  completedAt?: Date;
  dockerRunDurationsMs?: number[];
  workerId?: string;
  workerName?: string;
  claimedAt?: Date;
  retryCount?: number;
  needsAggregation?: boolean;
  completedSimCount?: number;
  totalSimCount?: number;
  results?: JobResults;
}

export interface CreateJobRequest {
  deckIds: string[]; // Length 4: each is a precon id or saved deck filename
  simulations: number;
  parallelism?: number;
  idempotencyKey?: string;
}

export const SIMULATIONS_MIN = 4;
export const SIMULATIONS_MAX = 100;
export const PARALLELISM_MIN = 1;
export const PARALLELISM_MAX = 16;

export interface Precon {
  id: string;
  name: string;
  filename: string;
  primaryCommander: string;
  setName?: string | null;
  archidektId?: number | null;
}

// ---------------------------------------------------------------------------
// TrueSkill Rating Types
// ---------------------------------------------------------------------------

/** TrueSkill rating for a deck, stored persistently. */
export interface DeckRating {
  deckId: string;
  mu: number;
  sigma: number;
  gamesPlayed: number;
  wins: number;
  lastUpdated: string;
  /** Denormalized deck metadata (for leaderboard without N+1 queries) */
  deckName?: string;
  setName?: string | null;
  isPrecon?: boolean;
  primaryCommander?: string | null;
}

/** A single resolved game result, stored for idempotency. */
export interface MatchResult {
  /** "{jobId}_{gameIndex}" */
  id: string;
  jobId: string;
  gameIndex: number;
  /** JSON-serializable array of 4 deck IDs */
  deckIds: string[];
  /** null if winner could not be resolved from logs */
  winnerDeckId: string | null;
  turnCount: number | null;
  playedAt: string;
}
