import { getDb } from './db';
import type { WorkerInfo } from './types';

/**
 * Upsert a worker heartbeat record.
 * Note: max_concurrent_override is NOT included — it's set separately via setMaxConcurrentOverride
 * and preserved across heartbeats by the ON CONFLICT clause.
 */
export function upsertHeartbeat(info: WorkerInfo): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO worker_heartbeats (worker_id, worker_name, status, current_job_id, capacity, active_simulations, uptime_ms, last_heartbeat, version, owner_email)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(worker_id) DO UPDATE SET
      worker_name = excluded.worker_name,
      status = excluded.status,
      current_job_id = excluded.current_job_id,
      capacity = excluded.capacity,
      active_simulations = excluded.active_simulations,
      uptime_ms = excluded.uptime_ms,
      last_heartbeat = excluded.last_heartbeat,
      version = excluded.version,
      owner_email = excluded.owner_email
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
    info.ownerEmail ?? null,
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
    max_concurrent_override: number | null;
    owner_email: string | null;
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
      maxConcurrentOverride: r.max_concurrent_override ?? null,
      ownerEmail: r.owner_email ?? null,
    }));
}

/**
 * Get the max concurrent override for a worker. Returns null if not set or worker not found.
 */
export function getMaxConcurrentOverride(workerId: string): number | null {
  const db = getDb();
  const row = db.prepare(
    'SELECT max_concurrent_override FROM worker_heartbeats WHERE worker_id = ?'
  ).get(workerId) as { max_concurrent_override: number | null } | undefined;
  return row?.max_concurrent_override ?? null;
}

/**
 * Set the max concurrent override for a worker. Pass null to clear.
 * Returns true if the worker was found and updated.
 */
export function setMaxConcurrentOverride(workerId: string, override: number | null): boolean {
  const db = getDb();
  const result = db.prepare(
    'UPDATE worker_heartbeats SET max_concurrent_override = ? WHERE worker_id = ?'
  ).run(override, workerId);
  return result.changes > 0;
}

/**
 * Get the owner email for a worker. Returns null if not set or worker not found.
 */
export function getOwnerEmail(workerId: string): string | null {
  const db = getDb();
  const row = db.prepare(
    'SELECT owner_email FROM worker_heartbeats WHERE worker_id = ?'
  ).get(workerId) as { owner_email: string | null } | undefined;
  return row?.owner_email ?? null;
}

/**
 * Count of QUEUED jobs.
 */
export function getQueueDepth(): number {
  const db = getDb();
  const row = db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'QUEUED'").get() as { count: number };
  return row.count;
}
