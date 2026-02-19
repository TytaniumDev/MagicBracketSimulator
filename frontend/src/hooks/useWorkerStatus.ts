import { useState, useEffect, useCallback, useRef } from 'react';
import { getApiBase, fetchPublic } from '../api';
import type { WorkerInfo } from '../types/worker';

interface WorkerStatusResult {
  workers: WorkerInfo[];
  queueDepth: number;
  isLoading: boolean;
}

/**
 * Polls GET /api/workers every 15 seconds to get worker fleet status.
 */
export function useWorkerStatus(): WorkerStatusResult {
  const [workers, setWorkers] = useState<WorkerInfo[]>([]);
  const [queueDepth, setQueueDepth] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const apiBase = getApiBase();
      const res = await fetchPublic(`${apiBase}/api/workers`);
      if (res.ok) {
        const data = await res.json();
        setWorkers(data.workers ?? []);
        setQueueDepth(data.queueDepth ?? 0);
      }
    } catch {
      // Non-fatal: keep showing last known state
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    intervalRef.current = setInterval(fetchStatus, 15_000);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [fetchStatus]);

  return { workers, queueDepth, isLoading };
}
