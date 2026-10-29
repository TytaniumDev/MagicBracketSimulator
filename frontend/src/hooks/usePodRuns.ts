import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { fetchPodRun, fetchPodRuns } from '../api';
import { reportHandledError } from '../errorReporting';
import type { PodRunResponse } from '@shared/types/pod-run';

/** LOCAL mode: how often to re-read a run whose pods haven't all finished. */
const LOCAL_POD_RUN_POLL_MS = 5_000;

function hasPodsLeft(run: PodRunResponse | undefined): boolean {
  return run != null && run.podsWithResults < run.podCount;
}

/**
 * One saved pod run, or nothing while `id` is undefined. Its standings grow
 * as pods finish, so while some are left it re-reads the run whenever the
 * run's doc changes (GCP mode) or every few seconds (LOCAL mode).
 */
export function usePodRun(id: string | undefined) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['podRun', id],
    queryFn: () => fetchPodRun(id!),
    enabled: id != null,
    staleTime: Infinity,
    retry: 1,
    refetchInterval: (q: { state: { data?: PodRunResponse } }) =>
      !db && hasPodsLeft(q.state.data) ? LOCAL_POD_RUN_POLL_MS : false,
  });

  const listen = db != null && id != null && hasPodsLeft(query.data);
  useEffect(() => {
    if (!listen) return;
    // The first snapshot is the state just fetched; only later ones are news.
    let first = true;
    return onSnapshot(
      doc(db!, 'podRuns', id!),
      () => {
        if (first) {
          first = false;
          return;
        }
        void queryClient.invalidateQueries({ queryKey: ['podRun', id] });
      },
      (error) => {
        console.error('[usePodRun] Firestore listener error:', error);
        reportHandledError(error, { action: 'podRunListener' });
      },
    );
  }, [listen, id, queryClient]);

  return query;
}

/** Most recent pod runs, for the front page. */
export function useRecentPodRuns(limit: number) {
  return useQuery({
    queryKey: ['podRuns', 'recent', limit],
    queryFn: () => fetchPodRuns({ limit }),
  });
}

/** Pod runs that include `jobId`. Usually zero or one. */
export function usePodRunsForJob(jobId: string | undefined) {
  return useQuery({
    queryKey: ['podRuns', 'job', jobId],
    queryFn: () => fetchPodRuns({ jobId: jobId! }),
    enabled: jobId != null,
  });
}
