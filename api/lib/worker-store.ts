import { getDb } from './db';
import type { WorkerInfo } from './types';

/**
 * Upsert a worker heartbeat record.
 */
export function upsertHeartbeat(info: WorkerInfo): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO worker_heartbeats (worker_id, worker_name, status, current_job_id, capacity, active_simulations, uptime_ms, last_heartbeat, version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(worker_id) DO UPDATE SET
      worker_name = excluded.worker_name,
      status = excluded.status,
      current_job_id = excluded.current_job_id,
      capacity = excluded.capacity,
      active_simulations = excluded.active_simulations,
      uptime_ms = excluded.uptime_ms,
      last_heartbeat = excluded.last_heartbeat,
      version = excluded.version
  `).run(
    info.workerId,
    info.workerName,
    info.status,
    info.currentJobId ?? null,
    info.capacity,
    info.activeSimulations,
    info.uptimeMs,
    info.lastHeartbeat,
    info.version ?? null,
  );
}

/**
 * Get workers whose last heartbeat is within the stale threshold.
 * Workers with status 'updating' get a longer threshold (5 min) to remain
 * visible during Watchtower image pulls and container restarts.
 */
export function getActiveWorkers(staleThresholdMs = 60_000): WorkerInfo[] {
  const db = getDb();
  const UPDATING_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes for updating workers
  const maxThreshold = Math.max(staleThresholdMs, UPDATING_THRESHOLD_MS);
  const cutoff = new Date(Date.now() - maxThreshold).toISOString();
  const rows = db.prepare(
    'SELECT * FROM worker_heartbeats WHERE last_heartbeat > ? ORDER BY worker_name ASC'
  ).all(cutoff) as Array<{
    worker_id: string;
    worker_name: string;
    status: string;
    current_job_id: string | null;
    capacity: number;
    active_simulations: number;
    uptime_ms: number;
    last_heartbeat: string;
    version: string | null;
  }>;

  const now = Date.now();
  return rows
    .filter((r) => {
      const age = now - new Date(r.last_heartbeat).getTime();
      return r.status === 'updating' ? age <= UPDATING_THRESHOLD_MS : age <= staleThresholdMs;
    })
    .map((r) => ({
      workerId: r.worker_id,
      workerName: r.worker_name,
      status: r.status as 'idle' | 'busy' | 'updating',
      ...(r.current_job_id && { currentJobId: r.current_job_id }),
      capacity: r.capacity,
      activeSimulations: r.active_simulations,
      uptimeMs: r.uptime_ms,
      lastHeartbeat: r.last_heartbeat,
      ...(r.version && { version: r.version }),
    }));
}

/**
 * Count of QUEUED jobs.
 */
export function getQueueDepth(): number {
  const db = getDb();
  const row = db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'QUEUED'").get() as { count: number };
  return row.count;
}
