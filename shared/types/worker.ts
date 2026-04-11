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
}
