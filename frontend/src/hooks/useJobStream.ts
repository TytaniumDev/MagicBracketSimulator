import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { doc, collection, onSnapshot, Timestamp } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../firebase';
import { getApiBase, fetchWithAuth } from '../api';
import { isTerminal } from '../utils/status';
import { GAMES_PER_CONTAINER } from '@shared/types/job';
import type { JobResponse } from '@shared/types/job';
import type { SimulationStatus } from '@shared/types/simulation';

async function fetchJob(jobId: string): Promise<JobResponse> {
  const apiBase = getApiBase();
  const res = await fetchWithAuth(`${apiBase}/api/jobs/${jobId}`);
  if (!res.ok) {
    if (res.status === 404) throw new Error('Job not found');
    throw new Error('Failed to load job');
  }
  return res.json();
}

async function fetchSimulations(jobId: string): Promise<SimulationStatus[]> {
  const apiBase = getApiBase();
  const res = await fetchWithAuth(`${apiBase}/api/jobs/${jobId}/simulations`);
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data.simulations) ? data.simulations : [];
}

/**
 * Extract real-time fields from a Firestore job document snapshot
 * and merge them into existing JobResponse data.
 */
function mergeFirestoreJobUpdate(
  prev: JobResponse | undefined,
  firestoreData: Record<string, unknown>,
): JobResponse | undefined {
  if (!prev) return prev;

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
    const v = firestoreData.startedAt;
    update.startedAt = v instanceof Timestamp ? v.toDate().toISOString() : v as string;
  }
  if (firestoreData.completedAt !== undefined) {
    const v = firestoreData.completedAt;
    update.completedAt = v instanceof Timestamp ? v.toDate().toISOString() : v as string;
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

  // Recompute durationMs if we have timestamps
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
 */
function firestoreSimToStatus(simId: string, data: Record<string, unknown>): SimulationStatus {
  return {
    simId,
    index: typeof data.index === 'number' ? data.index : (() => {
      const match = simId.match(/^sim_(\d+)$/);
      return match ? parseInt(match[1], 10) : 0;
    })(),
    state: (data.state as SimulationStatus['state']) ?? 'PENDING',
    workerId: data.workerId as string | undefined,
    workerName: data.workerName as string | undefined,
    startedAt: (() => {
      const v = data.startedAt;
      if (!v) return undefined;
      return v instanceof Timestamp ? v.toDate().toISOString() : v as string;
    })(),
    completedAt: (() => {
      const v = data.completedAt;
      if (!v) return undefined;
      return v instanceof Timestamp ? v.toDate().toISOString() : v as string;
    })(),
    durationMs: data.durationMs as number | undefined,
    errorMessage: data.errorMessage as string | undefined,
    winner: data.winner as string | undefined,
    winningTurn: data.winningTurn as number | undefined,
    winners: data.winners as string[] | undefined,
    winningTurns: data.winningTurns as number[] | undefined,
  };
}

/**
 * Real-time job streaming hook using Firestore onSnapshot + TanStack Query.
 *
 * - GCP mode (Firestore configured): REST fetch for initial data, Firestore
 *   onSnapshot for real-time updates pushed into the query cache.
 * - LOCAL mode (no Firestore): TanStack Query refetchInterval polling.
 */
export function useJobStream(jobId: string | undefined) {
  const queryClient = useQueryClient();
  const jobTerminalRef = useRef(false);

  // Track terminal state for refetchInterval
  const jobQuery = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => fetchJob(jobId!),
    enabled: !!jobId,
    // LOCAL mode: poll every 2s while job is active
    refetchInterval: !isFirebaseConfigured && !jobTerminalRef.current ? 2000 : false,
  });

  const simsQuery = useQuery({
    queryKey: ['job', jobId, 'simulations'],
    queryFn: () => fetchSimulations(jobId!),
    enabled: !!jobId,
    refetchInterval: !isFirebaseConfigured && !jobTerminalRef.current ? 2000 : false,
  });

  // Update terminal ref when job status changes
  const jobStatus = jobQuery.data?.status;
  useEffect(() => {
    if (jobStatus && isTerminal(jobStatus)) {
      jobTerminalRef.current = true;
    }
  }, [jobStatus]);

  // GCP mode: Firestore onSnapshot for real-time job updates
  useEffect(() => {
    if (!db || !jobId) return;

    const jobDocRef = doc(db, 'jobs', jobId);
    const unsubscribe = onSnapshot(
      jobDocRef,
      (snapshot) => {
        if (!snapshot.exists()) return;
        const data = snapshot.data();
        queryClient.setQueryData<JobResponse>(
          ['job', jobId],
          (prev) => mergeFirestoreJobUpdate(prev, data),
        );

        if (isTerminal(data.status as string)) {
          jobTerminalRef.current = true;
          // Do a final REST fetch to get complete data (deckLinks, colorIdentity, etc.)
          fetchJob(jobId).then((fullJob) => {
            queryClient.setQueryData(['job', jobId], fullJob);
          }).catch(() => { /* REST fetch is best-effort */ });
          unsubscribe();
        }
      },
      (error) => {
        console.error('[useJobStream] Firestore job listener error:', error);
      },
    );

    return () => unsubscribe();
  }, [jobId, queryClient]);

  // GCP mode: Firestore onSnapshot for real-time simulation updates
  useEffect(() => {
    if (!db || !jobId) return;

    const simsCollectionRef = collection(db, 'jobs', jobId, 'simulations');
    const unsubscribe = onSnapshot(
      simsCollectionRef,
      (snapshot) => {
        const sims: SimulationStatus[] = snapshot.docs.map((simDoc) =>
          firestoreSimToStatus(simDoc.id, simDoc.data()),
        );
        sims.sort((a, b) => a.index - b.index);
        queryClient.setQueryData(['job', jobId, 'simulations'], sims);

        // Unsubscribe if all sims are in terminal state
        if (sims.length > 0 && sims.every((s) => isTerminal(s.state))) {
          unsubscribe();
        }
      },
      (error) => {
        console.error('[useJobStream] Firestore simulations listener error:', error);
      },
    );

    return () => unsubscribe();
  }, [jobId, queryClient]);

  return {
    job: jobQuery.data ?? null,
    simulations: simsQuery.data ?? [],
    error: jobQuery.error?.message ?? simsQuery.error?.message ?? null,
    isLoading: jobQuery.isLoading,
  };
}
