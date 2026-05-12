/**
 * Shared types for worker fleet status.
 *
 * Used by both the API (worker heartbeat/registration) and
 * frontend (worker status display, admin override controls).
 */

export interface WorkerInfo {
  workerId: string;
  workerName: string;
  status: 'idle' | 'busy' | 'updating';
  currentJobId?: string;
  capacity: number;
  activeSimulations: number;
  uptimeMs: number;
  lastHeartbeat: string;
  version?: string;
  maxConcurrentOverride?: number | null;
  ownerEmail?: string | null;
  workerApiUrl?: string | null;

  /**
   * Distinguishes worker implementations. Optional for backward compat
   * with existing Docker workers (which never set this field).
   */
  workerType?: 'docker' | 'flutter';

  /**
   * Lease metadata. Only Flutter workers write this. Lease expiry drives
   * the lease-sweep recovery path (see api/lib/lease-sweep.ts).
   */
  lease?: {
    expiresAt: string;          // ISO timestamp; sweep query: where('lease.expiresAt', '<', now)
    activeSimIds: string[];     // sims this worker currently holds RUNNING
  };
}
