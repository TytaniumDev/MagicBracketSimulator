/**
 * SQLite implementation of PodRunStore (LOCAL mode).
 * Job membership lives in pod_run_jobs so a job's runs are an indexed lookup.
 */
import { v4 as uuidv4 } from 'uuid';
import type { PodRun, PodRunStore } from './pod-run-store';

function getDb() {
  const { getDb: _getDb } = require('./db') as { getDb: () => import('better-sqlite3').Database };
  return _getDb();
}

interface Row {
  id: string;
  deck_ids_json: string;
  deck_names_json: string;
  simulations: number;
  created_by: string;
  created_at: string;
  idempotency_key: string | null;
}

function rowToPodRun(row: Row): PodRun {
  const jobIds = getDb()
    .prepare('SELECT job_id FROM pod_run_jobs WHERE pod_run_id = ? ORDER BY position')
    .all(row.id) as { job_id: string }[];
  return {
    id: row.id,
    deckIds: JSON.parse(row.deck_ids_json),
    deckNames: JSON.parse(row.deck_names_json),
    jobIds: jobIds.map((j) => j.job_id),
    simulations: row.simulations,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at),
    ...(row.idempotency_key && { idempotencyKey: row.idempotency_key }),
  };
}

export const sqlitePodRunStore: PodRunStore = {
  async createPodRun(data) {
    const db = getDb();
    if (data.idempotencyKey) {
      const existing = db
        .prepare('SELECT * FROM pod_runs WHERE idempotency_key = ?')
        .get(data.idempotencyKey) as Row | undefined;
      if (existing) return rowToPodRun(existing);
    }
    const id = uuidv4();
    const createdAt = new Date();
    const insertRun = db.prepare(`
      INSERT INTO pod_runs (id, deck_ids_json, deck_names_json, simulations, created_by, created_at, idempotency_key)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertJob = db.prepare('INSERT INTO pod_run_jobs (pod_run_id, job_id, position) VALUES (?, ?, ?)');
    db.transaction(() => {
      insertRun.run(
        id,
        JSON.stringify(data.deckIds),
        JSON.stringify(data.deckNames),
        data.simulations,
        data.createdBy,
        createdAt.toISOString(),
        data.idempotencyKey ?? null,
      );
      data.jobIds.forEach((jobId, i) => insertJob.run(id, jobId, i));
    })();
    return { ...data, id, createdAt };
  },

  async getPodRun(id) {
    const row = getDb().prepare('SELECT * FROM pod_runs WHERE id = ?').get(id) as Row | undefined;
    return row ? rowToPodRun(row) : null;
  },

  async listPodRuns(limit) {
    const rows = getDb()
      .prepare('SELECT * FROM pod_runs ORDER BY created_at DESC, rowid DESC LIMIT ?')
      .all(limit) as Row[];
    return rows.map(rowToPodRun);
  },

  async listPodRunsForJob(jobId) {
    const rows = getDb()
      .prepare(`
        SELECT r.* FROM pod_runs r
        JOIN pod_run_jobs j ON j.pod_run_id = r.id
        WHERE j.job_id = ?
        ORDER BY r.created_at DESC, r.rowid DESC
      `)
      .all(jobId) as Row[];
    return rows.map(rowToPodRun);
  },
};
