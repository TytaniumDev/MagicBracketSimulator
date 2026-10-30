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

/** One seat's results, in the same order as the job's `seats`. */
export interface SeatResult {
  wins: number;
  /** Average turn this seat won on, or null with no wins. */
  avgWinTurn: number | null;
}

export interface JobResults {
  /** Total games actually played (may be < simulations if some failed) */
  gamesPlayed: number;
  /** Per-seat results, index-aligned with the job's `seats`. */
  seats: SeatResult[];
}

// ---------------------------------------------------------------------------
// Seats: the 4 decks of a job, in play order
// ---------------------------------------------------------------------------

/**
 * One seat of a job. Results are keyed by seat (position in `seats`), not
 * by deck name or id: the same deck may sit in more than one seat. The
 * deck's name, link and colors are copied in when the job is created, for
 * display.
 */
export interface JobSeat {
  deckId: string;
  name: string;
  /** The deck's external link (Moxfield, Archidekt), if it has one. */
  link: string | null;
  /** WUBRG color identity; empty when unknown. */
  colorIdentity: string[];
}

/** The seats' deck names, in seat order. */
export function seatNames(seats: readonly JobSeat[]): string[] {
  return seats.map((s) => s.name);
}

/** Wins by deck name, for display. A deck in two seats gets both seats' wins. */
export function winsByName(seats: readonly JobSeat[], results: JobResults): Record<string, number> {
  const wins: Record<string, number> = {};
  seats.forEach(({ name }, i) => {
    wins[name] = (wins[name] ?? 0) + (results.seats[i]?.wins ?? 0);
  });
  return wins;
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
  seats: JobSeat[];
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
  /** Source of the job (user-submitted or auto-coverage). */
  source?: JobSource;
  results: JobResults | null;
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
  seats: JobSeat[];
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
  source?: JobSource;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Number of games each simulation container runs sequentially. */
export const GAMES_PER_CONTAINER = 4;

/** Number of decks required per Commander simulation job (4-player Commander). */
export const REQUIRED_DECK_COUNT = 4;

/** Source of a job: user-created or auto-coverage system. */
export type JobSource = 'user' | 'coverage';
