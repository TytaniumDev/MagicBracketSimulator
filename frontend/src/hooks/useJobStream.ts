import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { doc, collection, onSnapshot, getDoc, getDocs, query, orderBy, Timestamp } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../firebase';
import { getApiBase, fetchWithAuth } from '../api';
import { isTerminal } from '../utils/status';
import { GAMES_PER_CONTAINER } from '@shared/types/job';
import type { JobResponse } from '@shared/types/job';
import type { SimulationStatus } from '@shared/types/simulation';

// ---------------------------------------------------------------------------
// REST API fetchers (LOCAL mode only)
// ---------------------------------------------------------------------------

async function fetchJobRest(jobId: string): Promise<JobResponse> {
  const apiBase = getApiBase();
  const res = await fetchWithAuth(`${apiBase}/api/jobs/${jobId}`);
  if (!res.ok) {
    if (res.status === 404) throw new Error('Job not found');
    throw new Error('Failed to load job');
  }
  return res.json();
}

async function fetchSimulationsRest(jobId: string): Promise<SimulationStatus[]> {
  const apiBase = getApiBase();
  const res = await fetchWithAuth(`${apiBase}/api/jobs/${jobId}/simulations`);
  if (!res.ok) throw new Error('Failed to load simulations');
  const data = await res.json();
  return Array.isArray(data.simulations) ? data.simulations : [];
}

// ---------------------------------------------------------------------------
// Firestore → JobResponse conversion
// ---------------------------------------------------------------------------

function timestampToIso(v: unknown): string | undefined {
  if (!v) return undefined;
  return v instanceof Timestamp ? v.toDate().toISOString() : v as string;
}

/**
 * Convert a raw Firestore job document into a JobResponse.
 * Deck links and color identity are resolved separately from the decks
 * collection in fetchJobFirestore.
 */
function firestoreDocToJobResponse(
  jobId: string,
  data: Record<string, unknown>,
): JobResponse {
  const decks = (data.decks as Array<{ name: string }>) ?? [];
  const deckNames = decks.map((d) => d.name);
  const deckIds = Array.isArray(data.deckIds) && data.deckIds.length === 4
    ? data.deckIds as string[]
    : undefined;

  const createdAt = timestampToIso(data.createdAt) ?? new Date().toISOString();
  const startedAt = timestampToIso(data.startedAt);
  const completedAt = timestampToIso(data.completedAt);

  const start = startedAt ? new Date(startedAt).getTime() : new Date(createdAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : null;
  const durationMs = end != null ? end - start : null;

  const gamesCompleted =
    (data.completedSimCount != null && (data.completedSimCount as number) > 0)
      ? (data.completedSimCount as number) * GAMES_PER_CONTAINER
      : (data.gamesCompleted as number ?? 0);

  const errorMessage = data.errorMessage as string | undefined;
  const dockerRunDurationsMs = data.dockerRunDurationsMs as number[] | undefined;
  const workerId = data.workerId as string | undefined;
  const workerName = data.workerName as string | undefined;
  const claimedAt = timestampToIso(data.claimedAt);

  return {
    id: jobId,
    name: deckNames.join(' vs '),
    deckNames,
    ...(deckIds ? { deckIds } : undefined),
    status: (data.status as JobResponse['status']) ?? 'QUEUED',
    simulations: (data.simulations as number) ?? 0,
    gamesCompleted,
    parallelism: (data.parallelism as number) ?? 4,
    createdAt,
    ...(errorMessage ? { errorMessage } : undefined),
    ...(startedAt ? { startedAt } : undefined),
    ...(completedAt ? { completedAt } : undefined),
    durationMs,
    ...(dockerRunDurationsMs ? { dockerRunDurationsMs } : undefined),
    ...(workerId ? { workerId } : undefined),
    ...(workerName ? { workerName } : undefined),
    ...(claimedAt ? { claimedAt } : undefined),
    retryCount: (data.retryCount as number) ?? 0,
    results: (data.results as JobResponse['results']) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Firestore direct reads (GCP mode — bypasses Cloud Run)
// ---------------------------------------------------------------------------

async function fetchJobFirestore(jobId: string): Promise<JobResponse> {
  const snapshot = await getDoc(doc(db!, 'jobs', jobId));
  if (!snapshot.exists()) throw new Error('Job not found');
  const job = firestoreDocToJobResponse(jobId, snapshot.data());

  // Resolve deck links and color identity directly from the decks collection.
  // These are parallel reads — no Cloud Run dependency.
  if (job.deckIds && job.deckIds.length === job.deckNames.length) {
    const deckSnapshots = await Promise.all(
      job.deckIds.map((id) => getDoc(doc(db!, 'decks', id))),
    );
    const deckLinks: Record<string, string | null> = {};
    const colorIdentity: Record<string, string[]> = {};
    for (let i = 0; i < deckSnapshots.length; i++) {
      const snap = deckSnapshots[i];
      const name = job.deckNames[i];
      if (snap.exists()) {
        const data = snap.data();
        deckLinks[name] = (data.link as string) ?? null;
        const ci = data.colorIdentity as string[] | undefined;
        if (ci && ci.length > 0) colorIdentity[name] = ci;
      } else {
        deckLinks[name] = null;
      }
    }
    job.deckLinks = deckLinks;
    if (Object.keys(colorIdentity).length > 0) job.colorIdentity = colorIdentity;
  }

  return job;
}

async function fetchSimulationsFirestore(jobId: string): Promise<SimulationStatus[]> {
  const simsRef = collection(db!, 'jobs', jobId, 'simulations');
  const q = query(simsRef, orderBy('index', 'asc'));
  const snapshot = await getDocs(q);
  return snapshot.docs
    .map((simDoc) => firestoreSimToStatus(simDoc.id, simDoc.data()))
    .filter((s): s is SimulationStatus => s !== null);
}

// ---------------------------------------------------------------------------
// Firestore snapshot helpers
// ---------------------------------------------------------------------------

/**
 * Merge real-time Firestore fields into an existing JobResponse.
 * Skips terminal jobs — the initial read is authoritative once complete.
 */
function mergeFirestoreJobUpdate(
  prev: JobResponse | undefined,
  firestoreData: Record<string, unknown>,
): JobResponse | undefined {
  if (!prev) return prev;
  if (isTerminal(prev.status)) return prev;

  const update: Partial<JobResponse> = {};

  if (firestoreData.status !== undefined) {
    update.status = firestoreData.status as JobResponse['status'];
  }
  if (firestoreData.completedSimCount !== undefined) {
    update.gamesCompleted = (firestoreData.completedSimCount as number) * GAMES_PER_CONTAINER;
  } else if (firestoreData.gamesCompleted !== undefined) {
    update.gamesCompleted = firestoreData.gamesCompleted as number;
  }
  if (firestoreData.results !== undefined) {
    update.results = firestoreData.results as JobResponse['results'];
  }
  if (firestoreData.startedAt !== undefined) {
    update.startedAt = timestampToIso(firestoreData.startedAt);
  }
  if (firestoreData.completedAt !== undefined) {
    update.completedAt = timestampToIso(firestoreData.completedAt);
  }
  if (firestoreData.errorMessage !== undefined) {
    update.errorMessage = firestoreData.errorMessage as string;
  }
  if (firestoreData.workerId !== undefined) {
    update.workerId = firestoreData.workerId as string;
  }
  if (firestoreData.workerName !== undefined) {
    update.workerName = firestoreData.workerName as string;
  }

  const startedAt = update.startedAt ?? prev.startedAt;
  const completedAt = update.completedAt ?? prev.completedAt;
  const createdAt = prev.createdAt;
  if (completedAt) {
    const start = startedAt ? new Date(startedAt).getTime() : new Date(createdAt).getTime();
    update.durationMs = new Date(completedAt).getTime() - start;
  }

  return { ...prev, ...update };
}

/**
 * Convert a Firestore simulation document to SimulationStatus.
 * Returns null for malformed simIds that can't be parsed.
 */
function firestoreSimToStatus(simId: string, data: Record<string, unknown>): SimulationStatus | null {
  const index = typeof data.index === 'number' ? data.index : (() => {
    const match = simId.match(/^sim_(\d+)$/);
    return match ? parseInt(match[1], 10) : -1;
  })();

  if (index === -1) return null;

  return {
    simId,
    index,
    state: (data.state as SimulationStatus['state']) ?? 'PENDING',
    workerId: data.workerId as string | undefined,
    workerName: data.workerName as string | undefined,
    startedAt: timestampToIso(data.startedAt),
    completedAt: timestampToIso(data.completedAt),
    durationMs: data.durationMs as number | undefined,
    errorMessage: data.errorMessage as string | undefined,
    winner: data.winner as string | undefined,
    winningTurn: data.winningTurn as number | undefined,
    winners: data.winners as string[] | undefined,
    winningTurns: data.winningTurns as number[] | undefined,
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Real-time job streaming hook.
 *
 * - GCP mode: reads job, deck metadata, and simulations directly from
 *   Firestore (no Cloud Run dependency). Firestore onSnapshot provides
 *   real-time updates for active jobs.
 * - LOCAL mode: TanStack Query polling against the REST API.
 */
export function useJobStream(jobId: string | undefined) {
  const queryClient = useQueryClient();

  // Primary data: Firestore direct reads in GCP mode, REST in local mode
  const jobQuery = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => db ? fetchJobFirestore(jobId!) : fetchJobRest(jobId!),
    enabled: !!jobId,
    refetchInterval: (query) => {
      if (isFirebaseConfigured) return false;
      const status = query.state.data?.status;
      if (status && isTerminal(status)) return false;
      return 2000;
    },
  });

  const simsQuery = useQuery({
    queryKey: ['job', jobId, 'simulations'],
    queryFn: () => db ? fetchSimulationsFirestore(jobId!) : fetchSimulationsRest(jobId!),
    enabled: !!jobId,
    refetchInterval: (query) => {
      if (isFirebaseConfigured) return false;
      const sims = query.state.data;
      if (sims && sims.length > 0 && sims.every((s) => isTerminal(s.state))) return false;
      return 2000;
    },
  });

  // GCP mode: Firestore onSnapshot for real-time updates on active jobs only.
  // Terminal jobs don't change, so the initial getDoc read is sufficient.
  const jobStatus = jobQuery.data?.status;
  const shouldListen = !!db && !!jobId && !!jobStatus && !isTerminal(jobStatus);

  useEffect(() => {
    if (!shouldListen || !jobId) return;

    let unsubscribed = false;
    const jobDocRef = doc(db!, 'jobs', jobId);
    const unsubscribe = onSnapshot(
      jobDocRef,
      (snapshot) => {
        if (!snapshot.exists()) return;
        const data = snapshot.data();

        const prev = queryClient.getQueryData<JobResponse>(['job', jobId]);
        const wasAlreadyTerminal = prev != null && isTerminal(prev.status);

        queryClient.setQueryData<JobResponse>(
          ['job', jobId],
          (prevData) => mergeFirestoreJobUpdate(prevData, data),
        );

        if (isTerminal(data.status as string) && !unsubscribed) {
          unsubscribed = true;
          if (!wasAlreadyTerminal) {
            // Re-read from Firestore to get final state with all fields
            fetchJobFirestore(jobId).then((fullJob) => {
              queryClient.setQueryData(['job', jobId], fullJob);
            }).catch((err) => {
              console.error('[useJobStream] Final Firestore fetch failed:', err);
            });
          }
          unsubscribe();
        }
      },
      (error) => {
        console.error('[useJobStream] Firestore job listener error:', error);
      },
    );

    return () => {
      if (!unsubscribed) {
        unsubscribed = true;
        unsubscribe();
      }
    };
  }, [shouldListen, jobId, queryClient]);

  useEffect(() => {
    if (!shouldListen || !jobId) return;

    let unsubscribed = false;
    const simsCollectionRef = collection(db!, 'jobs', jobId, 'simulations');
    const unsubscribe = onSnapshot(
      simsCollectionRef,
      (snapshot) => {
        const sims: SimulationStatus[] = snapshot.docs
          .map((simDoc) => firestoreSimToStatus(simDoc.id, simDoc.data()))
          .filter((s): s is SimulationStatus => s !== null);
        sims.sort((a, b) => a.index - b.index);
        queryClient.setQueryData(['job', jobId, 'simulations'], sims);

        if (sims.length > 0 && sims.every((s) => isTerminal(s.state)) && !unsubscribed) {
          unsubscribed = true;
          unsubscribe();
        }
      },
      (error) => {
        console.error('[useJobStream] Firestore simulations listener error:', error);
      },
    );

    return () => {
      if (!unsubscribed) {
        unsubscribed = true;
        unsubscribe();
      }
    };
  }, [shouldListen, jobId, queryClient]);

  return {
    job: jobQuery.data ?? null,
    simulations: simsQuery.data ?? [],
    error: jobQuery.error?.message ?? simsQuery.error?.message ?? null,
    isLoading: jobQuery.isLoading,
  };
}
