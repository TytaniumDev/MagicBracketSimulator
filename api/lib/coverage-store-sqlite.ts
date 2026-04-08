/**
 * SQLite implementation of CoverageStore (LOCAL mode).
 */
import type { CoverageStore, CoverageConfig } from './coverage-store';

function getDb() {
  const { getDb: _getDb } = require('./db') as { getDb: () => import('better-sqlite3').Database };
  return _getDb();
}

const DEFAULT_CONFIG: CoverageConfig = {
  enabled: false,
  targetGamesPerPair: 400,
  updatedAt: '',
  updatedBy: '',
};

export const sqliteCoverageStore: CoverageStore = {
  async getConfig(): Promise<CoverageConfig> {
    const db = getDb();
    const row = db
      .prepare('SELECT enabled, target_games_per_pair, updated_at, updated_by FROM coverage_config WHERE id = 1')
      .get() as { enabled: number; target_games_per_pair: number; updated_at: string; updated_by: string } | undefined;
    if (!row) return DEFAULT_CONFIG;
    return {
      enabled: row.enabled === 1,
      targetGamesPerPair: row.target_games_per_pair,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by,
    };
  },

  async updateConfig(update, updatedBy): Promise<CoverageConfig> {
    const db = getDb();
    const current = await this.getConfig();
    const enabled = update.enabled ?? current.enabled;
    const targetGamesPerPair = update.targetGamesPerPair ?? current.targetGamesPerPair;
    const updatedAt = new Date().toISOString();

    db.prepare(`
      INSERT INTO coverage_config (id, enabled, target_games_per_pair, updated_at, updated_by)
      VALUES (1, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        enabled = excluded.enabled,
        target_games_per_pair = excluded.target_games_per_pair,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by
    `).run(enabled ? 1 : 0, targetGamesPerPair, updatedAt, updatedBy);

    return { enabled, targetGamesPerPair, updatedAt, updatedBy };
  },
};
