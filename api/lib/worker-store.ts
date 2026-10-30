import { getDb } from './db';
import type { WorkerInfo } from './types';

/**
 * Online workers. Desktop workers publish presence only to the Realtime
 * Database, which local mode doesn't use, so local mode never lists any.
 */
export function getActiveWorkers(): WorkerInfo[] {
  return [];
}

/**
 * Count of QUEUED jobs.
 */
export function getQueueDepth(): number {
  const db = getDb();
  const row = db.prepare("SELECT COUNT(*) as count FROM jobs WHERE status = 'QUEUED'").get() as { count: number };
  return row.count;
}
