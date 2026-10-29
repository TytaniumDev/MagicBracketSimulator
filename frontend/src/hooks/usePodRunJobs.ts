import { useEffect } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { collection, documentId, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { fetchJob, mergeFirestoreJobUpdate } from './useJobStream';
import { isTerminal } from '../utils/status';
import { activePodChunks } from '../utils/pods';
import type { JobResponse } from '@shared/types/job';
import { reportHandledError } from '../errorReporting';

/** LOCAL mode: how often to re-read each pod that hasn't finished yet. */
const LOCAL_POD_POLL_MS = 5_000;

export interface PodRunJobs {
  /** Loaded jobs, in the order of `jobIds`. Pods still loading are omitted. */
  jobs: JobResponse[];
  isLoading: boolean;
  /** Ids that failed to load (e.g. deleted jobs). */
  missingIds: string[];
}

/**
 * Load every job in a pod run and keep the unfinished ones live.
 *
 * - GCP mode: one Firestore listener per batch of pods that still has an
 *   unfinished pod in it, pushing updates into the same ['job', id] cache the
 *   job page uses. A batch's listener stops once all of its pods are done.
 * - LOCAL mode: each unfinished pod polls the REST API.
 */
export function usePodRunJobs(jobIds: readonly string[]): PodRunJobs {
  const queryClient = useQueryClient();
  const result = useQueries({
    queries: jobIds.map((id) => ({
      queryKey: ['job', id],
      queryFn: () => fetchJob(id, queryClient),
      retry: 1,
      refetchInterval: (q: { state: { data?: JobResponse } }) =>
        db || isTerminal(q.state.data?.status) ? false : LOCAL_POD_POLL_MS,
    })),
    combine: (results) => ({
      jobs: results.map((r) => r.data).filter((j): j is JobResponse => j != null),
      isLoading: results.some((r) => r.isLoading),
      missingIds: jobIds.filter((_, i) => results[i].isError),
    }),
  });

  // Only loaded, unfinished pods need listening to. Pods that failed to load
  // or are still loading are left out until their first read lands.
  const unfinishedIds = result.jobs.filter((j) => !isTerminal(j.status)).map((j) => j.id);
  const chunks = activePodChunks(jobIds, new Set(unfinishedIds));
  // Stable string key so the effect only re-subscribes when a batch finishes.
  const chunksKey = chunks.map((c) => c.join(',')).join('|');

  useEffect(() => {
    if (!db || !chunksKey) return;
    const unsubscribes = chunksKey.split('|').map((chunkKey) =>
      onSnapshot(
        query(collection(db!, 'jobs'), where(documentId(), 'in', chunkKey.split(','))),
        (snapshot) => {
          for (const change of snapshot.docChanges()) {
            if (change.type === 'removed') continue;
            queryClient.setQueryData<JobResponse>(['job', change.doc.id], (prev) =>
              mergeFirestoreJobUpdate(prev, change.doc.data()),
            );
          }
        },
        (error) => {
          console.error('[usePodRunJobs] Firestore listener error:', error);
          reportHandledError(error, { action: 'podRunJobsListener' });
        },
      ),
    );
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [chunksKey, queryClient]);

  return result;
}
