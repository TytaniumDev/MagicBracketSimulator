/**
 * Coverage store interface — persists auto-coverage configuration.
 * Implemented by coverage-store-sqlite.ts (LOCAL) and coverage-store-firestore.ts (GCP).
 */

export interface CoverageConfig {
  enabled: boolean;
  targetGamesPerPair: number;
  updatedAt: string;
  updatedBy: string;
}

export interface CoverageStore {
  /** Get current coverage config. Returns defaults if never set. */
  getConfig(): Promise<CoverageConfig>;

  /** Update coverage config fields. */
  updateConfig(update: Partial<Pick<CoverageConfig, 'enabled' | 'targetGamesPerPair'>>, updatedBy: string): Promise<CoverageConfig>;
}
