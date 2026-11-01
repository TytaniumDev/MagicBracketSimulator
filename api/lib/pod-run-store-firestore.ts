/**
 * Firestore implementation of PodRunStore (GCP mode).
 * Job ids live in an array on the run doc, so "which run is this job in?"
 * is an array-contains query on the automatic single-field index.
 *
 * Each job in a run carries `podRunId`, and `appliedStats.podRun` once its
 * results are in the run's `standings`. Saving a run and aggregating a job
 * both total the job inside a transaction that reads the job, so a job that
 * finishes while its run is being saved is counted exactly once.
 */
import { FieldValue, Timestamp, type DocumentSnapshot, type Transaction } from '@google-cloud/firestore';
import { addPodResults, removePodResults, type PodRunTotals } from '@shared/types/pod-run';
import type { PodRun, PodRunStore } from './pod-run-store';
import { getFirestore } from './firestore-client';
import { finishedPod } from './pod-run-standings';

const firestore = getFirestore();
const podRunsCollection = firestore.collection('podRuns');
const jobsCollection = firestore.collection('jobs');

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
    standings: data.standings ?? {},
    podsWithResults: data.podsWithResults ?? 0,
  };
}

async function findByIdempotencyKey(key: string): Promise<PodRun | null> {
  const snapshot = await podRunsCollection.where('idempotencyKey', '==', key).limit(1).get();
  return snapshot.empty ? null : docToPodRun(snapshot.docs[0]);
}

/**
 * Record the run on each of its jobs not already in a run, and total the
 * ones that have results. Returns the run's starting standings.
 */
async function attachJobs(
  tx: Transaction,
  runId: string,
  jobIds: string[],
): Promise<{ standings: PodRunTotals; podsWithResults: number }> {
  let standings: PodRunTotals = {};
  let podsWithResults = 0;
  const snaps = jobIds.length > 0 ? await tx.getAll(...jobIds.map((id) => jobsCollection.doc(id))) : [];
  for (const snap of snaps) {
    if (!snap.exists || snap.get('podRunId')) continue;
    const pod = finishedPod(snap.data()!);
    if (pod && snap.get('appliedStats.podRun') !== true) {
      standings = addPodResults(standings, pod.seats, pod.results);
      podsWithResults++;
      tx.update(snap.ref, { podRunId: runId, 'appliedStats.podRun': true });
    } else {
      tx.update(snap.ref, { podRunId: runId });
    }
  }
  return { standings, podsWithResults };
}

export const firestorePodRunStore: PodRunStore = {
  async createPodRun(data) {
    if (data.idempotencyKey) {
      const existing = await findByIdempotencyKey(data.idempotencyKey);
      if (existing) return existing;
    }
    const ref = podRunsCollection.doc();
    const createdAt = Timestamp.now();
    const totals = await firestore.runTransaction(async (tx) => {
      const attached = await attachJobs(tx, ref.id, data.jobIds);
      tx.set(ref, {
        deckIds: data.deckIds,
        deckNames: data.deckNames,
        jobIds: data.jobIds,
        simulations: data.simulations,
        createdBy: data.createdBy,
        createdAt,
        idempotencyKey: data.idempotencyKey ?? null,
        ...attached,
      });
      return attached;
    });
    return { ...data, id: ref.id, createdAt: createdAt.toDate(), ...totals };
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

  async applyJob(jobId) {
    const jobRef = jobsCollection.doc(jobId);
    return firestore.runTransaction(async (tx) => {
      const jobSnap = await tx.get(jobRef);
      const runId = jobSnap.get('podRunId') as string | undefined;
      if (!jobSnap.exists || !runId || jobSnap.get('appliedStats.podRun') === true) return false;
      const pod = finishedPod(jobSnap.data()!);
      if (!pod) return false;

      const runRef = podRunsCollection.doc(runId);
      const runSnap = await tx.get(runRef);
      if (!runSnap.exists) return false;
      tx.update(runRef, {
        standings: addPodResults(runSnap.get('standings') ?? {}, pod.seats, pod.results),
        podsWithResults: (runSnap.get('podsWithResults') ?? 0) + 1,
      });
      tx.update(jobRef, { 'appliedStats.podRun': true });
      return true;
    });
  },

  async removeJob(jobId) {
    const jobRef = jobsCollection.doc(jobId);
    return firestore.runTransaction(async (tx) => {
      const jobSnap = await tx.get(jobRef);
      const runs = await tx.get(podRunsCollection.where('jobIds', 'array-contains', jobId));
      // Only the run named on the job holds its results.
      const countedIn = jobSnap.get('appliedStats.podRun') === true ? (jobSnap.get('podRunId') as string) : null;
      const pod = countedIn && jobSnap.exists ? finishedPod(jobSnap.data()!) : null;

      for (const run of runs.docs) {
        const jobIds = ((run.get('jobIds') as string[] | undefined) ?? []).filter((id) => id !== jobId);
        if (jobIds.length === 0) {
          tx.delete(run.ref);
        } else if (pod && run.id === countedIn) {
          tx.update(run.ref, {
            jobIds,
            standings: removePodResults(run.get('standings') ?? {}, pod.seats, pod.results),
            podsWithResults: Math.max((run.get('podsWithResults') ?? 0) - 1, 0),
          });
        } else {
          tx.update(run.ref, { jobIds });
        }
      }
      if (jobSnap.exists) tx.update(jobRef, { podRunId: FieldValue.delete(), 'appliedStats.podRun': false });
      return !runs.empty;
    });
  },
};
