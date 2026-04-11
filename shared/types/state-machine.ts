/**
 * Simulation and Job lifecycle state machines.
 *
 * Encodes the valid state transitions for simulations and jobs.
 * Used by the API to reject invalid transitions (e.g., COMPLETED→RUNNING)
 * which previously caused regressions with Pub/Sub redelivery.
 *
 * Valid simulation transitions:
 *   PENDING  → RUNNING | CANCELLED
 *   RUNNING  → COMPLETED | FAILED | CANCELLED
 *   FAILED   → PENDING (retry)
 *
 * Valid job transitions:
 *   QUEUED   → RUNNING | CANCELLED | FAILED
 *   RUNNING  → COMPLETED | FAILED | CANCELLED
 */

import type { SimulationState } from './simulation';
import type { JobStatus } from './job';

// ---------------------------------------------------------------------------
// Simulation state machine
// ---------------------------------------------------------------------------

const VALID_SIM_TRANSITIONS: Record<SimulationState, readonly SimulationState[]> = {
  PENDING:   ['RUNNING', 'CANCELLED'],
  RUNNING:   ['COMPLETED', 'FAILED', 'CANCELLED'],
  COMPLETED: [],                        // Terminal — no transitions allowed
  FAILED:    ['PENDING'],               // Retry: reset to PENDING for redelivery
  CANCELLED: [],                        // Terminal — no transitions allowed
};

/**
 * Check if a simulation state transition is valid.
 *
 * @returns true if transitioning from `from` to `to` is allowed
 */
export function canSimTransition(from: SimulationState, to: SimulationState): boolean {
  return VALID_SIM_TRANSITIONS[from].includes(to);
}

/** Terminal simulation states — no further transitions allowed. */
export const TERMINAL_SIM_STATES: readonly SimulationState[] = ['COMPLETED', 'CANCELLED'];

/**
 * Check if a simulation state is terminal (no further transitions possible).
 */
export function isTerminalSimState(state: SimulationState): boolean {
  return TERMINAL_SIM_STATES.includes(state);
}

// ---------------------------------------------------------------------------
// Job state machine
// ---------------------------------------------------------------------------

const VALID_JOB_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  QUEUED:    ['RUNNING', 'CANCELLED', 'FAILED'],
  RUNNING:   ['COMPLETED', 'FAILED', 'CANCELLED'],
  COMPLETED: [],                        // Terminal
  FAILED:    ['QUEUED', 'CANCELLED'],    // Retry: reset to QUEUED, or cancel permanently
  CANCELLED: [],                        // Terminal
};

/**
 * Check if a job status transition is valid.
 *
 * @returns true if transitioning from `from` to `to` is allowed
 */
export function canJobTransition(from: JobStatus, to: JobStatus): boolean {
  return VALID_JOB_TRANSITIONS[from].includes(to);
}

/**
 * Terminal job statuses — no further transitions allowed.
 * Note: FAILED is NOT terminal because jobs can be retried (FAILED → QUEUED).
 */
export const TERMINAL_JOB_STATES: readonly JobStatus[] = ['COMPLETED', 'CANCELLED'];

/**
 * Check if a job status is terminal (no further transitions possible).
 */
export function isTerminalJobState(status: JobStatus): boolean {
  return TERMINAL_JOB_STATES.includes(status);
}
