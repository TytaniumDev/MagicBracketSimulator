import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'jobs.db');

let db: Database.Database | null = null;

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * The LOCAL-mode database. Tables are created as they are now; there are no
 * migrations, so a database file from an older schema has to be deleted
 * (`api/data/jobs.db`).
 */
export function getDb(): Database.Database {
  if (db) return db;
  ensureDataDir();
  db = new Database(DB_PATH);

  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      decks_json TEXT NOT NULL DEFAULT '[]',
      deck_ids_json TEXT,
      status TEXT NOT NULL,
      simulations INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      result_json TEXT,
      error_message TEXT,
      idempotency_key TEXT,
      parallelism INTEGER,
      games_completed INTEGER,
      started_at TEXT,
      completed_at TEXT,
      docker_run_durations_ms TEXT,
      worker_id TEXT,
      worker_name TEXT,
      claimed_at TEXT,
      retry_count INTEGER DEFAULT 0,
      needs_aggregation INTEGER DEFAULT 0,
      source TEXT DEFAULT 'user',
      ratings_applied INTEGER,
      pod_run_id TEXT,
      pod_run_applied INTEGER
    )
  `);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_idempotency_key ON jobs(idempotency_key) WHERE idempotency_key IS NOT NULL`);

  // Per-simulation tracking
  db.exec(`
    CREATE TABLE IF NOT EXISTS simulations (
      sim_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      idx INTEGER NOT NULL,
      state TEXT NOT NULL DEFAULT 'PENDING',
      worker_id TEXT,
      worker_name TEXT,
      started_at TEXT,
      completed_at TEXT,
      duration_ms INTEGER,
      error_message TEXT,
      winner TEXT,
      winning_turn INTEGER,
      winners_json TEXT,
      winning_turns_json TEXT,
      lease_expires_at TEXT,
      PRIMARY KEY (job_id, sim_id),
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
    )
  `);

  // Worker heartbeat tracking
  db.exec(`
    CREATE TABLE IF NOT EXISTS worker_heartbeats (
      worker_id TEXT PRIMARY KEY,
      worker_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'idle',
      current_job_id TEXT,
      capacity INTEGER NOT NULL DEFAULT 0,
      active_simulations INTEGER NOT NULL DEFAULT 0,
      uptime_ms INTEGER NOT NULL DEFAULT 0,
      last_heartbeat TEXT NOT NULL,
      version TEXT,
      max_concurrent_override INTEGER,
      owner_email TEXT,
      worker_api_url TEXT
    )
  `);

  // Precons (synced from Archidekt)
  db.exec(`
    CREATE TABLE IF NOT EXISTS precons (
      id TEXT PRIMARY KEY,
      archidekt_id INTEGER UNIQUE,
      name TEXT NOT NULL,
      set_name TEXT,
      filename TEXT NOT NULL,
      primary_commander TEXT,
      color_identity TEXT,
      dck TEXT NOT NULL,
      link TEXT,
      archidekt_updated_at TEXT,
      synced_at TEXT NOT NULL,
      released_at TEXT
    )
  `);

  // Per-deck TrueSkill rating, win turns and pair game counts (rating-store.ts)
  db.exec(`
    CREATE TABLE IF NOT EXISTS ratings (
      deck_id TEXT PRIMARY KEY,
      mu REAL NOT NULL DEFAULT 25.0,
      sigma REAL NOT NULL DEFAULT 8.3333,
      games_played INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      last_updated TEXT NOT NULL,
      win_turn_sum INTEGER,
      win_turn_wins INTEGER,
      win_turn_histogram TEXT,
      pair_games TEXT
    )
  `);

  // Coverage config (singleton row)
  db.exec(`
    CREATE TABLE IF NOT EXISTS coverage_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      enabled INTEGER NOT NULL DEFAULT 0,
      target_games_per_pair INTEGER NOT NULL DEFAULT 400,
      updated_at TEXT NOT NULL DEFAULT '',
      updated_by TEXT NOT NULL DEFAULT ''
    )
  `);

  // Decks left out of deck selection (picker + auto-coverage)
  db.exec(`
    CREATE TABLE IF NOT EXISTS excluded_decks (
      deck_id TEXT PRIMARY KEY,
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL
    )
  `);

  // Pod runs: one selection of more than 4 decks, queued as every 4-deck pod
  db.exec(`
    CREATE TABLE IF NOT EXISTS pod_runs (
      id TEXT PRIMARY KEY,
      deck_ids_json TEXT NOT NULL,
      deck_names_json TEXT NOT NULL,
      simulations INTEGER NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      idempotency_key TEXT UNIQUE,
      standings_json TEXT NOT NULL DEFAULT '{}',
      pods_with_results INTEGER NOT NULL DEFAULT 0
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_pod_runs_created_at ON pod_runs(created_at)`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS pod_run_jobs (
      pod_run_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (pod_run_id, job_id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_pod_run_jobs_job_id ON pod_run_jobs(job_id)`);

  // Card impact counters: one JSON document per deck (see lib/card-impact/stats.ts)
  db.exec(`
    CREATE TABLE IF NOT EXISTS card_stats (
      deck_id TEXT PRIMARY KEY,
      data_json TEXT NOT NULL
    )
  `);

  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
