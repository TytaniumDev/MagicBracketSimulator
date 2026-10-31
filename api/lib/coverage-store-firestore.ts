/**
 * Firestore implementation of CoverageStore (GCP mode).
 * Uses @google-cloud/firestore directly (same pattern as firestore-job-store)
 * so it works without Firebase Admin initialization.
 */
import { Timestamp } from '@google-cloud/firestore';
import type { CoverageStore, CoverageConfig } from './coverage-store';
import { getFirestore } from './firestore-client';

const firestore = getFirestore();

const configDoc = firestore.collection('config').doc('coverage');

const DEFAULT_CONFIG: CoverageConfig = {
  enabled: false,
  targetGamesPerPair: 400,
  updatedAt: '',
  updatedBy: '',
};

/**
 * A stored time as an ISO string, or '' when it is not a Timestamp. The
 * config doc can outlive a schema change (it survived the 2026-10-30 data
 * reset with a string updatedAt), and the next update rewrites it.
 */
function timestampToIso(value: unknown): string {
  return value instanceof Timestamp ? value.toDate().toISOString() : '';
}

export const firestoreCoverageStore: CoverageStore = {
  async getConfig(): Promise<CoverageConfig> {
    const doc = await configDoc.get();
    if (!doc.exists) return DEFAULT_CONFIG;
    const data = doc.data()!;
    return {
      enabled: data.enabled ?? false,
      targetGamesPerPair: data.targetGamesPerPair ?? 400,
      updatedAt: timestampToIso(data.updatedAt),
      updatedBy: data.updatedBy ?? '',
    };
  },

  async updateConfig(update, updatedBy): Promise<CoverageConfig> {
    const current = await this.getConfig();
    const updatedAt = Timestamp.now();
    const config: CoverageConfig = {
      enabled: update.enabled ?? current.enabled,
      targetGamesPerPair: update.targetGamesPerPair ?? current.targetGamesPerPair,
      updatedAt: updatedAt.toDate().toISOString(),
      updatedBy,
    };
    await configDoc.set({ ...config, updatedAt });
    return config;
  },
};
