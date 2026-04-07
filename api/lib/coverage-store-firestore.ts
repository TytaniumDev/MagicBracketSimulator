/**
 * Firestore implementation of CoverageStore (GCP mode).
 */
import type { CoverageStore, CoverageConfig } from './coverage-store';
import { getFirestore } from 'firebase-admin/firestore';

const COLLECTION = 'config';
const DOC_ID = 'coverage';

const DEFAULT_CONFIG: CoverageConfig = {
  enabled: false,
  targetGamesPerPair: 400,
  updatedAt: '',
  updatedBy: '',
};

export const firestoreCoverageStore: CoverageStore = {
  async getConfig(): Promise<CoverageConfig> {
    const doc = await getFirestore().collection(COLLECTION).doc(DOC_ID).get();
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
    await getFirestore().collection(COLLECTION).doc(DOC_ID).set(config);
    return config;
  },
};
