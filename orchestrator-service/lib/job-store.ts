import { getDb } from './db';
import { Job, JobStatus, AnalysisResult } from './types';
import { v4 as uuidv4 } from 'uuid';

interface Row {
  id: string;
  deck_name: string;
  deck_dck: string;
  status: string;
  simulations: number;
  opponents: string;
  created_at: string;
  result_json: string | null;
  error_message: string | null;
  idempotency_key?: string | null;
  skip_analysis?: number | null;
  parallelism?: number | null;
  games_completed?: number | null;
}

function rowToJob(row: Row): Job {
  return {
    id: row.id,
    deckName: row.deck_name,
    deckDck: row.deck_dck,
    status: row.status as JobStatus,
    simulations: row.simulations,
    opponents: JSON.parse(row.opponents) as string[],
    createdAt: new Date(row.created_at),
    ...(row.result_json && { resultJson: JSON.parse(row.result_json) as AnalysisResult }),
    ...(row.error_message && { errorMessage: row.error_message }),
    ...(row.parallelism != null && { parallelism: row.parallelism }),
    ...(row.games_completed != null && { gamesCompleted: row.games_completed }),
  };
}

export function getJobByIdempotencyKey(key: string): Job | undefined {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM jobs WHERE idempotency_key = ?')
    .get(key) as Row | undefined;
  return row ? rowToJob(row) : undefined;
}

export function createJob(
  deckName: string,
  deckDck: string,
  opponents: string[],
  simulations: number,
  idempotencyKey?: string,
  parallelism?: number
): Job {
  if (idempotencyKey) {
    const existing = getJobByIdempotencyKey(idempotencyKey);
    if (existing) return existing;
  }
  const id = uuidv4();
  const createdAt = new Date().toISOString();
  const db = getDb();
  db.prepare(
    `INSERT INTO jobs (id, deck_name, deck_dck, status, simulations, opponents, created_at, idempotency_key, parallelism)
     VALUES (?, ?, ?, 'QUEUED', ?, ?, ?, ?, ?)`
  ).run(
    id,
    deckName,
    deckDck,
    simulations,
    JSON.stringify(opponents),
    createdAt,
    idempotencyKey ?? null,
    parallelism ?? null
  );
  return rowToJob({
    id,
    deck_name: deckName,
    deck_dck: deckDck,
    status: 'QUEUED',
    simulations,
    opponents: JSON.stringify(opponents),
    created_at: createdAt,
    result_json: null,
    error_message: null,
    idempotency_key: idempotencyKey ?? null,
    parallelism: parallelism ?? null,
  });
}

export function getJob(id: string): Job | undefined {
  const db = getDb();
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Row | undefined;
  return row ? rowToJob(row) : undefined;
}

export function updateJobStatus(id: string, status: JobStatus): boolean {
  const db = getDb();
  const result = db.prepare('UPDATE jobs SET status = ? WHERE id = ?').run(status, id);
  return result.changes > 0;
}

export function updateJobProgress(id: string, gamesCompleted: number): boolean {
  const db = getDb();
  const result = db.prepare('UPDATE jobs SET games_completed = ? WHERE id = ?').run(gamesCompleted, id);
  return result.changes > 0;
}

export function setJobResult(id: string, result: AnalysisResult): boolean {
  const db = getDb();
  const resultJson = JSON.stringify(result);
  const result_ = db
    .prepare('UPDATE jobs SET status = ?, result_json = ? WHERE id = ?')
    .run('COMPLETED', resultJson, id);
  return result_.changes > 0;
}

/**
 * Marks a job as COMPLETED without setting result_json.
 * Used when simulations finish but analysis is deferred to user action.
 */
export function setJobCompleted(id: string): boolean {
  const db = getDb();
  const result = db
    .prepare('UPDATE jobs SET status = ? WHERE id = ?')
    .run('COMPLETED', id);
  return result.changes > 0;
}

/**
 * Updates result_json for an already COMPLETED job.
 * Used for on-demand analysis after simulations are done.
 */
export function updateJobResult(id: string, result: AnalysisResult): boolean {
  const db = getDb();
  const resultJson = JSON.stringify(result);
  const result_ = db
    .prepare('UPDATE jobs SET result_json = ? WHERE id = ?')
    .run(resultJson, id);
  return result_.changes > 0;
}

export function setJobFailed(id: string, errorMessage: string): boolean {
  const db = getDb();
  const result = db
    .prepare('UPDATE jobs SET status = ?, error_message = ? WHERE id = ?')
    .run('FAILED', errorMessage, id);
  return result.changes > 0;
}

export function getNextQueuedJob(): Job | undefined {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM jobs WHERE status = 'QUEUED' ORDER BY created_at ASC LIMIT 1")
    .get() as Row | undefined;
  return row ? rowToJob(row) : undefined;
}

export function listJobs(): Job[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM jobs ORDER BY created_at DESC').all() as Row[];
  return rows.map(rowToJob);
}

export function clearJobs(): void {
  const db = getDb();
  db.prepare('DELETE FROM jobs').run();
}

export function getJobsMap(): Map<string, Job> {
  const jobs = listJobs();
  const map = new Map<string, Job>();
  for (const job of jobs) {
    map.set(job.id, job);
  }
  return map;
}
