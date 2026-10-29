/**
 * Sim leases: crash recovery without worker heartbeats.
 *
 * A worker that claims a sim with `?lease=1` reserves it until
 * `leaseExpiresAt`, and extends the lease while the sim keeps running
 * (`POST /api/jobs/:id/simulations/:simId/lease`). When a worker dies, its
 * lease simply runs out: the next claim takes the sim over, and stale-job
 * recovery resets it to PENDING. Idle workers write nothing.
 *
 * Sims claimed without a lease (older workers) keep the heartbeat-based
 * dead-worker check in recoverStaleSimulations.
 */
import type { SimulationStatus } from './types';

/** How long a claimed sim stays reserved without an extension. */
export const SIM_LEASE_MS = 3 * 60 * 1000;

/** Options for claimNextSim. */
export interface ClaimOptions {
  /** Reserve the sim with a lease the worker will extend (newer workers). */
  withLease?: boolean;
}

/** What a lease extension reports back to the worker. */
export type SimLeaseStatus =
  /** The lease was pushed back; keep running. */
  | 'extended'
  /** The sim's job was cancelled; stop the sim. */
  | 'cancelled'
  /** The sim is no longer this worker's (reclaimed, reset or finished); stop without reporting. */
  | 'lost';

/** The expiry for a lease taken or extended at `nowMs`, as an ISO string. */
export function simLeaseExpiry(nowMs: number = Date.now()): string {
  return new Date(nowMs + SIM_LEASE_MS).toISOString();
}

/** True when a RUNNING sim's lease has run out, so another worker may take it. */
export function isSimLeaseExpired(
  sim: Pick<SimulationStatus, 'state' | 'leaseExpiresAt'>,
  nowMs: number = Date.now(),
): boolean {
  if (sim.state !== 'RUNNING' || !sim.leaseExpiresAt) return false;
  return Date.parse(sim.leaseExpiresAt) < nowMs;
}

/** True when a sim can be claimed: PENDING, or RUNNING with an expired lease. */
export function isSimClaimable(
  sim: Pick<SimulationStatus, 'state' | 'leaseExpiresAt'>,
  nowMs: number = Date.now(),
): boolean {
  return sim.state === 'PENDING' || isSimLeaseExpired(sim, nowMs);
}

/** Decide how a lease extension request resolves, given the sim as it stands. */
export function resolveLeaseExtension(
  sim: Pick<SimulationStatus, 'state' | 'workerId'> | null,
  workerId: string,
): SimLeaseStatus {
  if (!sim) return 'lost';
  if (sim.state === 'CANCELLED') return 'cancelled';
  if (sim.state !== 'RUNNING' || sim.workerId !== workerId) return 'lost';
  return 'extended';
}
