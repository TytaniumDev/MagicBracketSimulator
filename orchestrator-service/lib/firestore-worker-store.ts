/**
 * Firestore-backed worker store for GCP.
 * Workers are keyed by refreshId (only workers that responded to current refresh round).
 */
import { Firestore } from '@google-cloud/firestore';

const firestore = new Firestore({
  projectId: process.env.GOOGLE_CLOUD_PROJECT || 'magic-bracket-simulator',
});

const workersCollection = firestore.collection('workers');
const metaRef = firestore.collection('meta').doc('worker-refresh');

export interface WorkerRecord {
  workerId: string;
  hostname?: string;
  subscription?: string;
  refreshId: string;
}

export async function setCurrentRefreshId(refreshId: string): Promise<void> {
  await metaRef.set({ currentRefreshId: refreshId });
}

export async function getCurrentRefreshId(): Promise<string> {
  const doc = await metaRef.get();
  const data = doc.data();
  return (data?.currentRefreshId as string) ?? '';
}

export async function upsertWorker(
  workerId: string,
  data: { hostname?: string; subscription?: string; refreshId: string }
): Promise<void> {
  await workersCollection.doc(workerId).set({
    hostname: data.hostname ?? null,
    subscription: data.subscription ?? null,
    refreshId: data.refreshId,
  });
}

export async function listWorkers(): Promise<WorkerRecord[]> {
  const current = await getCurrentRefreshId();
  if (!current) return [];
  const snapshot = await workersCollection.where('refreshId', '==', current).get();
  return snapshot.docs.map((doc) => {
    const d = doc.data();
    return {
      workerId: doc.id,
      hostname: d.hostname ?? undefined,
      subscription: d.subscription ?? undefined,
      refreshId: d.refreshId as string,
    };
  });
}

/**
 * Clean up old worker records to prevent unbounded collection growth.
 * Deletes workers that don't match the current refreshId.
 */
export async function cleanupOldWorkers(): Promise<void> {
  const current = await getCurrentRefreshId();
  if (!current) return;
  const snapshot = await workersCollection.where('refreshId', '!=', current).get();
  if (snapshot.empty) return;
  const batch = firestore.batch();
  snapshot.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
}
