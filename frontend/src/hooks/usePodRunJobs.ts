import { useQueries, useQueryClient } from '@tanstack/react-query';
import { fetchJob } from './useJobStream';
import { isTerminal } from '../utils/status';
import type { JobResponse } from '@shared/types/job';

/** How often to re-read each pod that hasn't finished yet. */
const ACTIVE_POD_POLL_MS = 15_000;

export interface PodRunJobs {
  /** Loaded jobs, in the order of `jobIds`. Pods still loading are omitted. */
  jobs: JobResponse[];
  isLoading: boolean;
  /** Ids that failed to load (e.g. deleted jobs). */
  missingIds: string[];
}

/**
 * Load every job in a pod run. Each job polls on its own until it reaches a
 * terminal state, so a long run stops reading the pods that are done.
 */
export function usePodRunJobs(jobIds: readonly string[]): PodRunJobs {
  const queryClient = useQueryClient();
  return useQueries({
    queries: jobIds.map((id) => ({
      queryKey: ['job', id],
      queryFn: () => fetchJob(id, queryClient),
      retry: 1,
      refetchInterval: (query: { state: { data?: JobResponse } }) =>
        isTerminal(query.state.data?.status) ? false : ACTIVE_POD_POLL_MS,
    })),
    combine: (results) => ({
      jobs: results.map((r) => r.data).filter((j): j is JobResponse => j != null),
      isLoading: results.some((r) => r.isLoading),
      missingIds: jobIds.filter((_, i) => results[i].isError),
    }),
  });
}
