/**
 * Lease-sweep recovery for Flutter workers.
 *
 * Flutter workers write a lease to their workers/{id} doc, refreshed every
 * 5 seconds with expiresAt = now + 15s. If a worker disappears (crash, network
 * drop, host sleep), the lease expires within 15 seconds. This module provides
 * the predicate and orchestration to detect expired leases and revert
 * affected RUNNING sims back to PENDING for re-claim.
 *
 * Docker workers never write a lease field, so the sweep query
 *   where('lease.expiresAt', '<', now)
 * automatically excludes them. There is no risk of touching Docker workers.
 */
import type { WorkerInfo } from './types';

export interface LeaseSweepDeps {
  getWorkersWithExpiredLeases: (nowMs: number) => Promise<WorkerInfo[]>;
  revertSimToPending: (
    jobId: string,
    simId: string,
    expectedWorkerId: string,
  ) => Promise<boolean>;
  markWorkerCrashed: (workerId: string) => Promise<void>;
}

export interface LeaseSweepResult {
  workersScanned: number;
  simsReverted: number;
  errors: string[];
}

/**
 * Pure predicate. Returns true iff the worker has a lease and the
 * lease.expiresAt timestamp is strictly less than nowMs.
 */
export function isLeaseExpired(worker: WorkerInfo, nowMs: number): boolean {
  if (!worker.lease) return false;
  return new Date(worker.lease.expiresAt).getTime() < nowMs;
}

/**
 * Run a single sweep pass. Side effects are isolated to the injected deps.
 * Sim ID format used in lease.activeSimIds is `${jobId}:${simId}` to avoid
 * an extra Firestore lookup (Flutter worker writes them in this format).
 */
export async function sweepExpiredLeases(
  deps: LeaseSweepDeps,
  nowMs: number = Date.now(),
): Promise<LeaseSweepResult> {
  const result: LeaseSweepResult = {
    workersScanned: 0,
    simsReverted: 0,
    errors: [],
  };

  const expired = await deps.getWorkersWithExpiredLeases(nowMs);
  result.workersScanned = expired.length;

  for (const worker of expired) {
    if (!worker.lease) continue; // defensive; query should guarantee this
    for (const compositeId of worker.lease.activeSimIds) {
      const [jobId, simId] = compositeId.split(':');
      if (!jobId || !simId) {
        result.errors.push(`malformed activeSimId: ${compositeId}`);
        continue;
      }
      try {
        const reverted = await deps.revertSimToPending(jobId, simId, worker.workerId);
        if (reverted) result.simsReverted += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`revert ${compositeId} on ${worker.workerId}: ${msg}`);
      }
    }
    try {
      await deps.markWorkerCrashed(worker.workerId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`markCrashed ${worker.workerId}: ${msg}`);
    }
  }

  return result;
}
