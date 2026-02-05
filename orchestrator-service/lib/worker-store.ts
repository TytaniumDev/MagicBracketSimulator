/**
 * SQLite-backed worker store for local development.
 * Workers are keyed by refreshId (only workers that responded to current refresh round).
 */
import { getDb } from './db';

export interface WorkerRecord {
  workerId: string;
  hostname?: string;
  subscription?: string;
  refreshId: string;
}

export function setCurrentRefreshId(refreshId: string): void {
  const db = getDb();
  db.prepare(`INSERT OR REPLACE INTO worker_refresh (id, refresh_id) VALUES (1, ?)`).run(refreshId);
}

export function getCurrentRefreshId(): string {
  const db = getDb();
  const row = db.prepare(`SELECT refresh_id FROM worker_refresh WHERE id = 1`).get() as { refresh_id: string } | undefined;
  return row?.refresh_id ?? '';
}

export function upsertWorker(workerId: string, data: { hostname?: string; subscription?: string; refreshId: string }): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO workers (worker_id, hostname, subscription, refresh_id) VALUES (?, ?, ?, ?)
     ON CONFLICT(worker_id) DO UPDATE SET hostname = ?, subscription = ?, refresh_id = ?`
  ).run(
    workerId,
    data.hostname ?? null,
    data.subscription ?? null,
    data.refreshId,
    data.hostname ?? null,
    data.subscription ?? null,
    data.refreshId
  );
}

export function listWorkers(): WorkerRecord[] {
  const db = getDb();
  const current = getCurrentRefreshId();
  if (!current) return [];
  const rows = db.prepare(
    `SELECT worker_id, hostname, subscription, refresh_id FROM workers WHERE refresh_id = ?`
  ).all(current) as { worker_id: string; hostname: string | null; subscription: string | null; refresh_id: string }[];
  return rows.map((r) => ({
    workerId: r.worker_id,
    hostname: r.hostname ?? undefined,
    subscription: r.subscription ?? undefined,
    refreshId: r.refresh_id,
  }));
}
