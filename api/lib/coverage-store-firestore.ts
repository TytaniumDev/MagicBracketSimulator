/**
 * Firestore implementation of CoverageStore (GCP mode).
 * Uses @google-cloud/firestore directly (same pattern as firestore-job-store)
 * so it works without Firebase Admin initialization.
 */
import type { CoverageStore, CoverageConfig } from './coverage-store';
import { Firestore } from '@google-cloud/firestore';

const firestore = new Firestore({
  projectId: process.env.GOOGLE_CLOUD_PROJECT || 'magic-bracket-simulator',
});

const configDoc = firestore.collection('config').doc('coverage');

const DEFAULT_CONFIG: CoverageConfig = {
  enabled: false,
  targetGamesPerPair: 400,
  updatedAt: '',
  updatedBy: '',
};

export const firestoreCoverageStore: CoverageStore = {
  async getConfig(): Promise<CoverageConfig> {
    const doc = await configDoc.get();
    if (!doc.exists) return DEFAULT_CONFIG;
    const data = doc.data()!;
    return {
      enabled: data.enabled ?? false,
      targetGamesPerPair: data.targetGamesPerPair ?? 400,
      updatedAt: data.updatedAt ?? '',
      updatedBy: data.updatedBy ?? '',
    };
  },

  async updateConfig(update, updatedBy): Promise<CoverageConfig> {
    const current = await this.getConfig();
    const config: CoverageConfig = {
      enabled: update.enabled ?? current.enabled,
      targetGamesPerPair: update.targetGamesPerPair ?? current.targetGamesPerPair,
      updatedAt: new Date().toISOString(),
      updatedBy,
    };
    await configDoc.set(config);
    return config;
  },
};
