import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { DeckSlot } from './types';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'jobs.db');

let db: Database.Database | null = null;

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * Migrate existing jobs from old schema (deck_name, deck_dck, opponents) to new schema (decks_json).
 */
function migrateJobsToDecksJson(database: Database.Database): void {
  // First check if the legacy columns exist at all
  const tableInfo = database.prepare('PRAGMA table_info(jobs)').all() as { name: string }[];
  const columnNames = new Set(tableInfo.map((c) => c.name));
  
  // If legacy columns don't exist, nothing to migrate
  if (!columnNames.has('deck_name') || !columnNames.has('deck_dck') || !columnNames.has('opponents')) {
    return;
  }

  // Check if there are rows needing migration (have deck_name but no decks_json)
  const rowsToMigrate = database
    .prepare(`SELECT id, deck_name, deck_dck, opponents FROM jobs WHERE deck_name IS NOT NULL AND (decks_json IS NULL OR decks_json = '')`)
    .all() as { id: string; deck_name: string; deck_dck: string; opponents: string }[];

  if (rowsToMigrate.length === 0) {
    return;
  }

  console.log(`[DB Migration] Migrating ${rowsToMigrate.length} jobs to new decks_json schema...`);

  const updateStmt = database.prepare(`UPDATE jobs SET decks_json = ? WHERE id = ?`);

  for (const row of rowsToMigrate) {
    try {
      // Parse opponents (array of precon IDs)
      const opponentIds = JSON.parse(row.opponents) as string[];

      // Build the decks array: first is the user deck, rest are precons
      const decks: DeckSlot[] = [{ name: row.deck_name, dck: row.deck_dck }];

      for (const oppIdOrName of opponentIds) {
        // Legacy migration: precon files no longer on disk, use placeholder
        console.warn(`[DB Migration] Legacy precon reference: ${oppIdOrName}, using placeholder`);
        decks.push({ name: oppIdOrName, dck: '' });
      }

      // Update the row
      updateStmt.run(JSON.stringify(decks), row.id);
      console.log(`[DB Migration] Migrated job ${row.id}`);
    } catch (error) {
      console.error(`[DB Migration] Failed to migrate job ${row.id}:`, error);
    }
  }

  console.log(`[DB Migration] Migration complete.`);
}

/**
 * Drop legacy columns (deck_name, deck_dck, opponents) after all rows have decks_json.
 * Requires SQLite 3.35+ for DROP COLUMN support.
 */
function dropLegacyColumns(database: Database.Database): void {
  const tableInfo = database.prepare('PRAGMA table_info(jobs)').all() as { name: string }[];
  const columnNames = new Set(tableInfo.map((c) => c.name));

  const legacyColumns = ['deck_name', 'deck_dck', 'opponents'];
  for (const col of legacyColumns) {
    if (columnNames.has(col)) {
      try {
        database.exec(`ALTER TABLE jobs DROP COLUMN ${col}`);
        console.log(`[DB Migration] Dropped legacy column: ${col}`);
      } catch (err) {
        // SQLite < 3.35 doesn't support DROP COLUMN; just log and continue
        console.warn(`[DB Migration] Could not drop column ${col}:`, err);
      }
    }
  }
}

export function getDb(): Database.Database {
  if (db) return db;
  ensureDataDir();
  db = new Database(DB_PATH);

  // Create table with new schema if it doesn't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      decks_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL,
      simulations INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      result_json TEXT,
      error_message TEXT,
      idempotency_key TEXT,
      parallelism INTEGER,
      games_completed INTEGER
    )
  `);

  // Add columns that may be missing from older schemas
  try {
    db.exec(`ALTER TABLE jobs ADD COLUMN decks_json TEXT`);
  } catch {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE jobs ADD COLUMN idempotency_key TEXT`);
  } catch {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE jobs ADD COLUMN parallelism INTEGER`);
  } catch {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE jobs ADD COLUMN games_completed INTEGER`);
  } catch {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE jobs ADD COLUMN started_at TEXT`);
  } catch {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE jobs ADD COLUMN completed_at TEXT`);
  } catch {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE jobs ADD COLUMN docker_run_durations_ms TEXT`);
  } catch {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE jobs ADD COLUMN deck_ids_json TEXT`);
  } catch {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE jobs ADD COLUMN worker_id TEXT`);
  } catch {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE jobs ADD COLUMN claimed_at TEXT`);
  } catch {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE jobs ADD COLUMN worker_name TEXT`);
  } catch {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE jobs ADD COLUMN retry_count INTEGER DEFAULT 0`);
  } catch {
    // Column already exists
  }

  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_idempotency_key ON jobs(idempotency_key) WHERE idempotency_key IS NOT NULL`);

  // Workers and current refresh round (for frontend-triggered worker visibility)
  db.exec(`
    CREATE TABLE IF NOT EXISTS workers (
      worker_id TEXT PRIMARY KEY,
      hostname TEXT,
      subscription TEXT,
      refresh_id TEXT
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS worker_refresh (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      refresh_id TEXT
    )
  `);
  try {
    db.exec(`INSERT OR IGNORE INTO worker_refresh (id, refresh_id) VALUES (1, '')`);
  } catch {
    // Already exists
  }

  // Per-simulation tracking table
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
      PRIMARY KEY (job_id, sim_id),
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
    )
  `);

  // Add worker_name column to simulations if missing (migration)
  try {
    db.exec(`ALTER TABLE simulations ADD COLUMN worker_name TEXT`);
  } catch {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE simulations ADD COLUMN winners_json TEXT`);
  } catch {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE simulations ADD COLUMN winning_turns_json TEXT`);
  } catch {
    // Column already exists
  }

  // Worker heartbeat tracking table
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
      version TEXT
    )
  `);

  // Precons table (synced from Archidekt)
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
      synced_at TEXT NOT NULL
    )
  `);

  // Add per-worker concurrency override and owner email columns
  try {
    db.exec(`ALTER TABLE worker_heartbeats ADD COLUMN max_concurrent_override INTEGER`);
  } catch {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE worker_heartbeats ADD COLUMN owner_email TEXT`);
  } catch {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE worker_heartbeats ADD COLUMN worker_api_url TEXT`);
  } catch {
    // Column already exists
  }

  // TrueSkill ratings per deck
  db.exec(`
    CREATE TABLE IF NOT EXISTS ratings (
      deck_id TEXT PRIMARY KEY,
      mu REAL NOT NULL DEFAULT 25.0,
      sigma REAL NOT NULL DEFAULT 8.3333,
      games_played INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      last_updated TEXT NOT NULL
    )
  `);

  // Per-game match results for idempotency tracking
  db.exec(`
    CREATE TABLE IF NOT EXISTS match_results (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      game_index INTEGER NOT NULL,
      deck_ids TEXT NOT NULL,
      winner_deck_id TEXT,
      turn_count INTEGER,
      played_at TEXT NOT NULL
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_match_results_job_id ON match_results(job_id)`);

  // Run migration for existing jobs (populates decks_json from legacy columns)
  migrateJobsToDecksJson(db);

  // Drop legacy columns after migration (deck_name, deck_dck, opponents)
  dropLegacyColumns(db);

  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
