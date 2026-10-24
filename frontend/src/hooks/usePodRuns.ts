import { useQuery } from '@tanstack/react-query';
import { fetchPodRun, fetchPodRuns } from '../api';

/** Saved pod runs are immutable, so they never need re-reading once loaded. */
const POD_RUN_STALE_MS = Infinity;

/** One saved pod run, or nothing while `id` is undefined. */
export function usePodRun(id: string | undefined) {
  return useQuery({
    queryKey: ['podRun', id],
    queryFn: () => fetchPodRun(id!),
    enabled: id != null,
    staleTime: POD_RUN_STALE_MS,
    retry: 1,
  });
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
