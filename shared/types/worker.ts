/**
 * Shared types for worker fleet status.
 *
 * Used by both the API (active workers for recovery and health checks) and
 * the frontend (worker status display). Built from the desktop workers'
 * presence entries (see worker-presence.ts).
 */

export interface WorkerInfo {
  workerId: string;
  workerName: string;
  status: 'idle' | 'busy';
  capacity: number;
  activeSimulations: number;
  uptimeMs: number;
  lastHeartbeat: string;
}
