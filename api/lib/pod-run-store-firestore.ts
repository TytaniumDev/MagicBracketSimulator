/**
 * Firestore implementation of PodRunStore (GCP mode).
 * Job ids live in an array on the run doc, so "which run is this job in?"
 * is an array-contains query on the automatic single-field index.
 */
import { Timestamp, type DocumentSnapshot } from '@google-cloud/firestore';
import type { PodRun, PodRunStore } from './pod-run-store';
import { getFirestore } from './firestore-client';

const podRunsCollection = getFirestore().collection('podRuns');

function docToPodRun(doc: DocumentSnapshot): PodRun | null {
  const data = doc.data();
  if (!data) return null;
  return {
    id: doc.id,
    deckIds: data.deckIds ?? [],
    deckNames: data.deckNames ?? [],
    jobIds: data.jobIds ?? [],
    simulations: data.simulations ?? 0,
    createdBy: data.createdBy ?? 'unknown',
    createdAt: (data.createdAt as Timestamp | undefined)?.toDate() ?? new Date(0),
    ...(data.idempotencyKey && { idempotencyKey: data.idempotencyKey }),
  };
}

async function findByIdempotencyKey(key: string): Promise<PodRun | null> {
  const snapshot = await podRunsCollection.where('idempotencyKey', '==', key).limit(1).get();
  return snapshot.empty ? null : docToPodRun(snapshot.docs[0]);
}

export const firestorePodRunStore: PodRunStore = {
  async createPodRun(data) {
    if (data.idempotencyKey) {
      const existing = await findByIdempotencyKey(data.idempotencyKey);
      if (existing) return existing;
    }
    const ref = podRunsCollection.doc();
    const createdAt = Timestamp.now();
    await ref.set({
      deckIds: data.deckIds,
      deckNames: data.deckNames,
      jobIds: data.jobIds,
      simulations: data.simulations,
      createdBy: data.createdBy,
      createdAt,
      idempotencyKey: data.idempotencyKey ?? null,
    });
    return { ...data, id: ref.id, createdAt: createdAt.toDate() };
  },

  async getPodRun(id) {
    return docToPodRun(await podRunsCollection.doc(id).get());
  },

  async listPodRuns(limit) {
    const snapshot = await podRunsCollection.orderBy('createdAt', 'desc').limit(limit).get();
    return snapshot.docs.map(docToPodRun).filter((r): r is PodRun => r != null);
  },

  async listPodRunsForJob(jobId) {
    // No orderBy: that would need a composite index. Sorted in memory instead;
    // a job is in at most a handful of runs.
    const snapshot = await podRunsCollection.where('jobIds', 'array-contains', jobId).get();
    return snapshot.docs
      .map(docToPodRun)
      .filter((r): r is PodRun => r != null)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  },
};
