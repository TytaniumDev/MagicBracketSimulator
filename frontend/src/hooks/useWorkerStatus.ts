import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getApiBase, fetchWithAuth } from '../api';
import type { WorkerInfo } from '../types/worker';

interface WorkerStatusResult {
  workers: WorkerInfo[];
  queueDepth: number;
  isLoading: boolean;
  refresh: () => Promise<void>;
}

async function fetchWorkerStatus(): Promise<{ workers: WorkerInfo[]; queueDepth: number }> {
  const apiBase = getApiBase();
  const res = await fetchWithAuth(`${apiBase}/api/workers`);
  if (!res.ok) return { workers: [], queueDepth: 0 };
  const data = await res.json();
  return { workers: data.workers ?? [], queueDepth: data.queueDepth ?? 0 };
}

/**
 * Polls GET /api/workers every 15 seconds to get worker fleet status.
 * Pass enabled=false to skip polling (e.g. for unauthenticated users).
 */
export function useWorkerStatus(enabled = true): WorkerStatusResult {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['workers'],
    queryFn: fetchWorkerStatus,
    enabled,
    refetchInterval: 15_000,
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['workers'] });
  };

  return {
    workers: data?.workers ?? [],
    queueDepth: data?.queueDepth ?? 0,
    isLoading,
    refresh,
  };
}
