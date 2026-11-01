/**
 * SQLite implementation of PodRunStore (LOCAL mode).
 * Job membership lives in pod_run_jobs so a job's runs are an indexed lookup.
 *
 * Standings live on the run (`standings_json`, `pods_with_results`); each
 * job in a run records it in `jobs.pod_run_id`, and `jobs.pod_run_applied`
 * once its results are in the standings.
 */
import { v4 as uuidv4 } from 'uuid';
import { addPodResults, removePodResults, type PodRunTotals } from '@shared/types/pod-run';
import type { JobResults } from '@shared/types/job';
import type { PodRun, PodRunStore } from './pod-run-store';
import { finishedPod } from './pod-run-standings';

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
  standings_json: string;
  pods_with_results: number;
}

interface JobRow {
  id: string;
  seats_json: string;
  result_json: string | null;
  pod_run_id: string | null;
  pod_run_applied: number | null;
}

function jobFinishedPod(job: JobRow) {
  return finishedPod({
    seats: JSON.parse(job.seats_json),
    results: job.result_json ? (JSON.parse(job.result_json) as JobResults) : null,
  });
}

/**
 * Record the run on each of its jobs not already in a run, total the ones
 * that have results, and save the run's standings. Call inside a transaction.
 */
function attachJobs(runId: string, jobIds: string[]): { standings: PodRunTotals; podsWithResults: number } {
  const db = getDb();
  const selectJob = db.prepare('SELECT * FROM jobs WHERE id = ?');
  const markJob = db.prepare('UPDATE jobs SET pod_run_id = ?, pod_run_applied = ? WHERE id = ?');
  let standings: PodRunTotals = {};
  let podsWithResults = 0;
  for (const jobId of jobIds) {
    const job = selectJob.get(jobId) as JobRow | undefined;
    if (!job || job.pod_run_id) continue;
    const pod = job.pod_run_applied ? null : jobFinishedPod(job);
    if (pod) {
      standings = addPodResults(standings, pod.seats, pod.results);
      podsWithResults++;
    }
    markJob.run(runId, pod ? 1 : job.pod_run_applied, jobId);
  }
  db.prepare('UPDATE pod_runs SET standings_json = ?, pods_with_results = ? WHERE id = ?').run(
    JSON.stringify(standings),
    podsWithResults,
    runId,
  );
  return { standings, podsWithResults };
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
    standings: JSON.parse(row.standings_json),
    podsWithResults: row.pods_with_results ?? 0,
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
    const totals = db.transaction(() => {
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
      return attachJobs(id, data.jobIds);
    })();
    return { ...data, id, createdAt, ...totals };
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

  async applyJob(jobId) {
    const db = getDb();
    return db.transaction(() => {
      const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as JobRow | undefined;
      if (!job?.pod_run_id || job.pod_run_applied) return false;
      const pod = jobFinishedPod(job);
      if (!pod) return false;
      const run = db.prepare('SELECT * FROM pod_runs WHERE id = ?').get(job.pod_run_id) as Row | undefined;
      if (!run) return false;

      const standings = addPodResults(JSON.parse(run.standings_json), pod.seats, pod.results);
      db.prepare('UPDATE pod_runs SET standings_json = ?, pods_with_results = pods_with_results + 1 WHERE id = ?').run(
        JSON.stringify(standings),
        run.id,
      );
      db.prepare('UPDATE jobs SET pod_run_applied = 1 WHERE id = ?').run(jobId);
      return true;
    })();
  },

  async removeJob(jobId) {
    const db = getDb();
    return db.transaction(() => {
      const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as JobRow | undefined;
      const runIds = (
        db.prepare('SELECT pod_run_id FROM pod_run_jobs WHERE job_id = ?').all(jobId) as { pod_run_id: string }[]
      ).map((r) => r.pod_run_id);
      // Only the run named on the job holds its results.
      const countedIn = job?.pod_run_applied ? job.pod_run_id : null;
      const pod = countedIn && job ? jobFinishedPod(job) : null;

      for (const runId of runIds) {
        db.prepare('DELETE FROM pod_run_jobs WHERE pod_run_id = ? AND job_id = ?').run(runId, jobId);
        const { left } = db.prepare('SELECT COUNT(*) AS left FROM pod_run_jobs WHERE pod_run_id = ?').get(runId) as {
          left: number;
        };
        if (left === 0) {
          db.prepare('DELETE FROM pod_runs WHERE id = ?').run(runId);
        } else if (pod && runId === countedIn) {
          const run = db.prepare('SELECT * FROM pod_runs WHERE id = ?').get(runId) as Row;
          const standings = removePodResults(JSON.parse(run.standings_json), pod.seats, pod.results);
          db.prepare(
            'UPDATE pod_runs SET standings_json = ?, pods_with_results = MAX(pods_with_results - 1, 0) WHERE id = ?',
          ).run(JSON.stringify(standings), runId);
        }
      }
      db.prepare('UPDATE jobs SET pod_run_id = NULL, pod_run_applied = 0 WHERE id = ?').run(jobId);
      return runIds.length > 0;
    })();
  },
};
