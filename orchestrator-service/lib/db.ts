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

export function getDb(): Database.Database {
  if (db) return db;
  ensureDataDir();
  db = new Database(DB_PATH);

  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      deck_name TEXT NOT NULL,
      deck_dck TEXT NOT NULL,
      status TEXT NOT NULL,
      simulations INTEGER NOT NULL,
      opponents TEXT NOT NULL,
      created_at TEXT NOT NULL,
      result_json TEXT,
      error_message TEXT
    )
  `);
  try {
    db.exec(`ALTER TABLE jobs ADD COLUMN idempotency_key TEXT`);
  } catch {
    // Column already exists
  }
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_idempotency_key ON jobs(idempotency_key) WHERE idempotency_key IS NOT NULL`);

  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
