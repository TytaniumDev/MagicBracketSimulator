import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { readPreconContentByIdOrName } from './precons';
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
        const preconContent = readPreconContentByIdOrName(oppIdOrName);
        if (preconContent) {
          decks.push(preconContent);
        } else {
          // If precon not found, use placeholder with the ID/name
          console.warn(`[DB Migration] Precon not found for: ${oppIdOrName}, using placeholder`);
          decks.push({ name: oppIdOrName, dck: '' });
        }
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
