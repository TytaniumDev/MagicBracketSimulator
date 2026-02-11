import { getDb } from './db';
import { Job, JobStatus, AnalysisResult, DeckSlot } from './types';
import { v4 as uuidv4 } from 'uuid';

interface Row {
  id: string;
  decks_json: string;
  deck_ids_json?: string | null;
  status: string;
  simulations: number;
  created_at: string;
  result_json: string | null;
  error_message: string | null;
  idempotency_key?: string | null;
  parallelism?: number | null;
  games_completed?: number | null;
  started_at?: string | null;
  completed_at?: string | null;
  docker_run_durations_ms?: string | null;
}

function rowToJob(row: Row): Job {
  const decks = JSON.parse(row.decks_json) as DeckSlot[];
  const deckIds =
    row.deck_ids_json != null && row.deck_ids_json !== ''
      ? (JSON.parse(row.deck_ids_json) as string[])
      : undefined;
  return {
    id: row.id,
    decks,
    ...(deckIds != null && deckIds.length === 4 && { deckIds }),
    status: row.status as JobStatus,
    simulations: row.simulations,
    createdAt: new Date(row.created_at),
    ...(row.result_json && { resultJson: JSON.parse(row.result_json) as AnalysisResult }),
    ...(row.error_message && { errorMessage: row.error_message }),
    ...(row.parallelism != null && { parallelism: row.parallelism }),
    ...(row.games_completed != null && { gamesCompleted: row.games_completed }),
    ...(row.started_at && { startedAt: new Date(row.started_at) }),
    ...(row.completed_at && { completedAt: new Date(row.completed_at) }),
    ...(row.docker_run_durations_ms != null && row.docker_run_durations_ms !== '' && { dockerRunDurationsMs: JSON.parse(row.docker_run_durations_ms) as number[] }),
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
  decks: DeckSlot[],
  simulations: number,
  idempotencyKey?: string,
  parallelism?: number,
  deckIds?: string[]
): Job {
  if (idempotencyKey) {
    const existing = getJobByIdempotencyKey(idempotencyKey);
    if (existing) return existing;
  }
  const id = uuidv4();
  const createdAt = new Date().toISOString();
  const db = getDb();

  db.prepare(
    `INSERT INTO jobs (id, decks_json, deck_ids_json, status, simulations, created_at, idempotency_key, parallelism)
     VALUES (?, ?, ?, 'QUEUED', ?, ?, ?, ?)`
  ).run(
    id,
    JSON.stringify(decks),
    deckIds != null && deckIds.length === 4 ? JSON.stringify(deckIds) : null,
    simulations,
    createdAt,
    idempotencyKey ?? null,
    parallelism ?? null
  );
  return {
    id,
    decks,
    ...(deckIds != null && deckIds.length === 4 && { deckIds }),
    status: 'QUEUED',
    simulations,
    createdAt: new Date(createdAt),
    ...(parallelism != null && { parallelism }),
  };
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

export function setJobStartedAt(id: string): boolean {
  const db = getDb();
  const now = new Date().toISOString();
  const result = db.prepare('UPDATE jobs SET started_at = ? WHERE id = ?').run(now, id);
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

export interface SetJobCompletedOptions {
  completedAt?: Date;
  dockerRunDurationsMs?: number[];
}

/**
 * Marks a job as COMPLETED without setting result_json.
 * Used when simulations finish but analysis is deferred to user action.
 */
export function setJobCompleted(id: string, options?: SetJobCompletedOptions): boolean {
  const db = getDb();
  const completedAt = options?.completedAt ?? new Date();
  const dockerRunDurationsJson = options?.dockerRunDurationsMs != null ? JSON.stringify(options.dockerRunDurationsMs) : null;
  const result = db
    .prepare('UPDATE jobs SET status = ?, completed_at = ?, docker_run_durations_ms = ? WHERE id = ?')
    .run('COMPLETED', completedAt.toISOString(), dockerRunDurationsJson, id);
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

export interface SetJobFailedOptions {
  completedAt?: Date;
  dockerRunDurationsMs?: number[];
}

export function setJobFailed(id: string, errorMessage: string, options?: SetJobFailedOptions): boolean {
  const db = getDb();
  const completedAt = options?.completedAt ?? new Date();
  const dockerRunDurationsJson = options?.dockerRunDurationsMs != null ? JSON.stringify(options.dockerRunDurationsMs) : null;
  const result = db
    .prepare('UPDATE jobs SET status = ?, error_message = ?, completed_at = ?, docker_run_durations_ms = ? WHERE id = ?')
    .run('FAILED', errorMessage, completedAt.toISOString(), dockerRunDurationsJson, id);
  return result.changes > 0;
}

/**
 * Deletes a job by id. Returns true if a row was deleted.
 */
export function deleteJob(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
  return result.changes > 0;
}

export function getNextQueuedJob(): Job | undefined {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM jobs WHERE status = 'QUEUED' ORDER BY created_at ASC LIMIT 1")
    .get() as Row | undefined;
  return row ? rowToJob(row) : undefined;
}

/**
 * Atomically claim the next QUEUED job by transitioning it to RUNNING.
 * Returns the claimed job, or undefined if no QUEUED jobs exist.
 */
export function claimNextJob(): Job | undefined {
  const db = getDb();
  const now = new Date().toISOString();
  // SQLite doesn't support UPDATE ... RETURNING with LIMIT in all versions,
  // so we use a transaction: select then update.
  const claimTx = db.transaction(() => {
    const row = db
      .prepare("SELECT * FROM jobs WHERE status = 'QUEUED' ORDER BY created_at ASC LIMIT 1")
      .get() as Row | undefined;
    if (!row) return undefined;
    db.prepare("UPDATE jobs SET status = 'RUNNING', started_at = ? WHERE id = ? AND status = 'QUEUED'")
      .run(now, row.id);
    return { ...row, status: 'RUNNING', started_at: now } as Row;
  });
  const row = claimTx();
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
