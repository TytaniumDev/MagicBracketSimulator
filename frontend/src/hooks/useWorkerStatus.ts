import { useEffect, useState, useCallback } from 'react';
import { collection, query, where, onSnapshot, getCountFromServer } from 'firebase/firestore';
import { db } from '../firebase';
import { getApiBase, fetchWithAuth } from '../api';
import type { WorkerInfo } from '../types/worker';

// Stale thresholds matching api/lib/firestore-worker-store.ts
const STALE_THRESHOLD_MS = 60_000;
const UPDATING_THRESHOLD_MS = 5 * 60 * 1000;

function isWorkerActive(data: Record<string, unknown>): boolean {
  const age = Date.now() - new Date(data.lastHeartbeat as string).getTime();
  return data.status === 'updating' ? age <= UPDATING_THRESHOLD_MS : age <= STALE_THRESHOLD_MS;
}

function docToWorkerInfo(docId: string, data: Record<string, unknown>): WorkerInfo {
  return {
    workerId: docId,
    workerName: data.workerName as string,
    status: data.status as 'idle' | 'busy' | 'updating',
    ...(data.currentJobId ? { currentJobId: data.currentJobId as string } : undefined),
    capacity: (data.capacity as number) ?? 0,
    activeSimulations: (data.activeSimulations as number) ?? 0,
    uptimeMs: (data.uptimeMs as number) ?? 0,
    lastHeartbeat: data.lastHeartbeat as string,
    ...(data.version ? { version: data.version as string } : undefined),
    maxConcurrentOverride: (data.maxConcurrentOverride as number | null) ?? null,
    ownerEmail: (data.ownerEmail as string | null) ?? null,
    workerApiUrl: (data.workerApiUrl as string | null) ?? null,
  };
}

// REST fallback for LOCAL mode
async function fetchWorkerStatusRest(): Promise<{ workers: WorkerInfo[]; queueDepth: number }> {
  const apiBase = getApiBase();
  const res = await fetchWithAuth(`${apiBase}/api/workers`);
  if (!res.ok) return { workers: [], queueDepth: 0 };
  const data = await res.json();
  return { workers: data.workers ?? [], queueDepth: data.queueDepth ?? 0 };
}

interface WorkerStatusResult {
  workers: WorkerInfo[];
  queueDepth: number;
  isLoading: boolean;
  refresh: () => Promise<void>;
}

/**
 * Worker fleet status hook.
 *
 * - GCP mode: Firestore onSnapshot for real-time worker updates (no polling).
 *   Queue depth via lightweight count query.
 * - LOCAL mode: REST polling every 15 seconds.
 */
export function useWorkerStatus(enabled = true): WorkerStatusResult {
  const [workers, setWorkers] = useState<WorkerInfo[]>([]);
  const [queueDepth, setQueueDepth] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  const fetchQueueDepth = useCallback(async () => {
    if (!db) return;
    try {
      const q = query(collection(db, 'jobs'), where('status', '==', 'QUEUED'));
      const snapshot = await getCountFromServer(q);
      setQueueDepth(snapshot.data().count);
    } catch {
      // Non-fatal
    }
  }, []);

  // GCP mode: Firestore onSnapshot for workers
  useEffect(() => {
    if (!db || !enabled) return;

    // Query workers with recent heartbeats (use max threshold to get all potentially active)
    const cutoff = new Date(Date.now() - UPDATING_THRESHOLD_MS).toISOString();
    const q = query(
      collection(db, 'workers'),
      where('lastHeartbeat', '>', cutoff),
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const active = snapshot.docs
        .filter((doc) => isWorkerActive(doc.data()))
        .map((doc) => docToWorkerInfo(doc.id, doc.data()));
      setWorkers(active);
      setIsLoading(false);
    }, () => {
      setIsLoading(false);
    });

    // Fetch queue depth initially and every 15s
    fetchQueueDepth();
    const interval = setInterval(fetchQueueDepth, 15_000);

    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [enabled, fetchQueueDepth]);

  // LOCAL mode: REST polling fallback
  useEffect(() => {
    if (db || !enabled) return;

    let cancelled = false;
    const poll = async () => {
      const data = await fetchWorkerStatusRest();
      if (!cancelled) {
        setWorkers(data.workers);
        setQueueDepth(data.queueDepth);
        setIsLoading(false);
      }
    };

    poll();
    const interval = setInterval(poll, 15_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [enabled]);

  const refresh = useCallback(async () => {
    if (db) {
      await fetchQueueDepth();
    } else {
      const data = await fetchWorkerStatusRest();
      setWorkers(data.workers);
      setQueueDepth(data.queueDepth);
    }
  }, [fetchQueueDepth]);

  return { workers, queueDepth, isLoading, refresh };
}
