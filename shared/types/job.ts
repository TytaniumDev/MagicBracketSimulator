/**
 * Shared API response types for job data.
 *
 * These types represent the **serialized JSON** that flows over HTTP/SSE
 * between the API and frontend. The API's internal Job type uses Date
 * objects; these types use ISO strings because that's what JSON.stringify
 * produces.
 *
 * Both api/ and frontend/ import from here so any field change becomes
 * a compile error in both projects.
 */

// ---------------------------------------------------------------------------
// Job status enum
// ---------------------------------------------------------------------------

export type JobStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

// ---------------------------------------------------------------------------
// Aggregated results
// ---------------------------------------------------------------------------

export interface JobResults {
  /** Per-deck win counts. Key = deck name, value = number of wins */
  wins: Record<string, number>;
  /** Per-deck average winning turn. Key = deck name, value = avg turn */
  avgWinTurn: Record<string, number>;
  /** Total games actually played (may be < simulations if some failed) */
  gamesPlayed: number;
}

// ---------------------------------------------------------------------------
// Worker fleet summary (embedded in SSE/REST responses)
// ---------------------------------------------------------------------------

export interface WorkersSummary {
  online: number;
  idle: number;
  busy: number;
  updating?: number;
}

// ---------------------------------------------------------------------------
// Full job detail — GET /api/jobs/:id (frontend consumer)
// ---------------------------------------------------------------------------

export interface JobResponse {
  id: string;
  name: string;
  deckNames: string[];
  /** Original deck IDs used to create the job (for re-submission). May be absent on older jobs. */
  deckIds?: string[];
  status: JobStatus;
  simulations: number;
  gamesCompleted: number;
  parallelism: number;
  createdAt: string;
  errorMessage?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs: number | null;
  dockerRunDurationsMs?: number[];
  workerId?: string;
  workerName?: string;
  claimedAt?: string;
  retryCount: number;
  results: JobResults | null;
  /** Present when job has stored deck IDs that resolve to Moxfield/external links */
  deckLinks?: Record<string, string | null>;
  /** Per-deck color identity (WUBRG arrays) */
  colorIdentity?: Record<string, string[]>;
  /** Queue position (present while QUEUED, from SSE stream events) */
  queuePosition?: number;
  /** Worker fleet summary (present while QUEUED, from SSE stream events) */
  workers?: WorkersSummary;
}

// ---------------------------------------------------------------------------
// Job list item — GET /api/jobs
// ---------------------------------------------------------------------------

export interface JobSummary {
  id: string;
  name: string;
  deckNames: string[];
  status: JobStatus;
  simulations: number;
  gamesCompleted: number;
  createdAt: string;
  durationMs: number | null;
  parallelism?: number;
  errorMessage?: string;
  startedAt?: string;
  completedAt?: string;
  dockerRunDurationsMs?: number[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Number of games each simulation container runs sequentially. */
export const GAMES_PER_CONTAINER = 4;

/** Number of decks required per Commander simulation job (4-player Commander). */
export const REQUIRED_DECK_COUNT = 4;
