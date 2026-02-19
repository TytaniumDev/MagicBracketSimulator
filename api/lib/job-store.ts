import { getDb } from './db';
import { Job, JobStatus, AnalysisResult, DeckSlot, SimulationStatus, SimulationState } from './types';
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
  worker_id?: string | null;
  worker_name?: string | null;
  claimed_at?: string | null;
  retry_count?: number | null;
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
    ...(row.worker_id && { workerId: row.worker_id }),
    ...(row.worker_name && { workerName: row.worker_name }),
    ...(row.claimed_at && { claimedAt: new Date(row.claimed_at) }),
    ...(row.retry_count != null && row.retry_count > 0 && { retryCount: row.retry_count }),
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

export function setJobStartedAt(id: string, workerId?: string, workerName?: string): boolean {
  const db = getDb();
  const now = new Date().toISOString();
  const result = db.prepare('UPDATE jobs SET started_at = ?, worker_id = ?, worker_name = ?, claimed_at = ? WHERE id = ?').run(now, workerId ?? null, workerName ?? null, now, id);
  return result.changes > 0;
}

export function updateJobProgress(id: string, gamesCompleted: number): boolean {
  const db = getDb();
  const result = db.prepare('UPDATE jobs SET games_completed = ? WHERE id = ?').run(gamesCompleted, id);
  return result.changes > 0;
}

/**
 * Atomically increment gamesCompleted counter.
 * @param count Number of games to increment by (default 1, typically GAMES_PER_CONTAINER).
 */
export function incrementGamesCompleted(id: string, count: number = 1): boolean {
  const db = getDb();
  const result = db.prepare('UPDATE jobs SET games_completed = COALESCE(games_completed, 0) + ? WHERE id = ?').run(count, id);
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
 * Cancel a job: set status to CANCELLED, mark PENDING simulations as CANCELLED.
 * Only works for QUEUED or RUNNING jobs. Returns true if the job was cancelled.
 */
export function cancelJob(id: string): boolean {
  const db = getDb();
  const cancelTx = db.transaction(() => {
    const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Row | undefined;
    if (!row) return false;
    if (row.status !== 'QUEUED' && row.status !== 'RUNNING') return false;

    const now = new Date().toISOString();
    db.prepare("UPDATE jobs SET status = 'CANCELLED', completed_at = ? WHERE id = ?").run(now, id);
    db.prepare("UPDATE simulations SET state = 'CANCELLED' WHERE job_id = ? AND state IN ('PENDING', 'RUNNING')").run(id);
    return true;
  });
  return cancelTx();
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
export function claimNextJob(workerId?: string, workerName?: string): Job | undefined {
  const db = getDb();
  const now = new Date().toISOString();
  // SQLite doesn't support UPDATE ... RETURNING with LIMIT in all versions,
  // so we use a transaction: select then update.
  const claimTx = db.transaction(() => {
    const row = db
      .prepare("SELECT * FROM jobs WHERE status = 'QUEUED' ORDER BY created_at ASC LIMIT 1")
      .get() as Row | undefined;
    if (!row) return undefined;
    db.prepare("UPDATE jobs SET status = 'RUNNING', started_at = ?, worker_id = ?, worker_name = ?, claimed_at = ? WHERE id = ? AND status = 'QUEUED'")
      .run(now, workerId ?? null, workerName ?? null, now, row.id);
    return { ...row, status: 'RUNNING', started_at: now, worker_id: workerId ?? null, worker_name: workerName ?? null, claimed_at: now } as Row;
  });
  const row = claimTx();
  return row ? rowToJob(row) : undefined;
}

export function listJobs(): Job[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM jobs ORDER BY created_at DESC').all() as Row[];
  return rows.map(rowToJob);
}

export function listActiveJobs(): Job[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM jobs WHERE status IN ('QUEUED', 'RUNNING') ORDER BY created_at ASC")
    .all() as Row[];
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

// ─── Per-Simulation Tracking ─────────────────────────────────────────────────

interface SimRow {
  sim_id: string;
  job_id: string;
  idx: number;
  state: string;
  worker_id: string | null;
  worker_name: string | null;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  error_message: string | null;
  winner: string | null;
  winning_turn: number | null;
}

function simRowToStatus(row: SimRow): SimulationStatus {
  return {
    simId: row.sim_id,
    index: row.idx,
    state: row.state as SimulationState,
    ...(row.worker_id != null && { workerId: row.worker_id }),
    ...(row.worker_name != null && { workerName: row.worker_name }),
    ...(row.started_at != null && { startedAt: row.started_at }),
    ...(row.completed_at != null && { completedAt: row.completed_at }),
    ...(row.duration_ms != null && { durationMs: row.duration_ms }),
    ...(row.error_message != null && { errorMessage: row.error_message }),
    ...(row.winner != null && { winner: row.winner }),
    ...(row.winning_turn != null && { winningTurn: row.winning_turn }),
  };
}

/**
 * Initialize simulation tracking rows for a job.
 * Creates `count` rows with state PENDING.
 */
export function initializeSimulations(jobId: string, count: number): void {
  const db = getDb();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO simulations (sim_id, job_id, idx, state) VALUES (?, ?, ?, 'PENDING')`
  );
  const tx = db.transaction(() => {
    for (let i = 0; i < count; i++) {
      const simId = `sim_${String(i).padStart(3, '0')}`;
      insert.run(simId, jobId, i);
    }
  });
  tx();
}

/**
 * Update a single simulation's status fields.
 */
export function updateSimulationStatus(
  jobId: string,
  simId: string,
  update: Partial<SimulationStatus>
): boolean {
  const db = getDb();
  const sets: string[] = [];
  const values: unknown[] = [];

  if (update.state !== undefined) {
    sets.push('state = ?');
    values.push(update.state);
  }
  if (update.workerId !== undefined) {
    sets.push('worker_id = ?');
    values.push(update.workerId);
  }
  if (update.workerName !== undefined) {
    sets.push('worker_name = ?');
    values.push(update.workerName);
  }
  if (update.startedAt !== undefined) {
    sets.push('started_at = ?');
    values.push(update.startedAt);
  }
  if (update.completedAt !== undefined) {
    sets.push('completed_at = ?');
    values.push(update.completedAt);
  }
  if (update.durationMs !== undefined) {
    sets.push('duration_ms = ?');
    values.push(update.durationMs);
  }
  if (update.errorMessage !== undefined) {
    sets.push('error_message = ?');
    values.push(update.errorMessage);
  }
  if (update.winner !== undefined) {
    sets.push('winner = ?');
    values.push(update.winner);
  }
  if (update.winningTurn !== undefined) {
    sets.push('winning_turn = ?');
    values.push(update.winningTurn);
  }

  if (sets.length === 0) return false;

  values.push(jobId, simId);
  const result = db
    .prepare(`UPDATE simulations SET ${sets.join(', ')} WHERE job_id = ? AND sim_id = ?`)
    .run(...values);
  return result.changes > 0;
}

/**
 * Get all simulation statuses for a job, ordered by index.
 */
export function getSimulationStatuses(jobId: string): SimulationStatus[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM simulations WHERE job_id = ? ORDER BY idx ASC')
    .all(jobId) as SimRow[];
  return rows.map(simRowToStatus);
}

/**
 * Reset a job for retry: set status to QUEUED, clear runtime fields, increment retryCount.
 */
export function resetJobForRetry(id: string): boolean {
  const db = getDb();
  const result = db.prepare(
    `UPDATE jobs SET
      status = 'QUEUED',
      started_at = NULL,
      completed_at = NULL,
      error_message = NULL,
      games_completed = NULL,
      worker_id = NULL,
      worker_name = NULL,
      claimed_at = NULL,
      docker_run_durations_ms = NULL,
      retry_count = COALESCE(retry_count, 0) + 1
    WHERE id = ?`
  ).run(id);
  return result.changes > 0;
}

/**
 * Delete all simulation tracking rows for a job.
 */
export function deleteSimulations(jobId: string): void {
  const db = getDb();
  db.prepare('DELETE FROM simulations WHERE job_id = ?').run(jobId);
}

