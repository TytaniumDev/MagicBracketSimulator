import { useEffect, useState, useCallback } from 'react';
import { collection, query, where, getCountFromServer } from 'firebase/firestore';
import { ref, onValue } from 'firebase/database';
import { db, rtdb } from '../firebase';
import { getApiBase, fetchWithAuth } from '../api';
import type { WorkerInfo } from '../types/worker';
import { reportHandledError } from '../errorReporting';
import {
  PRESENCE_PATH,
  activeWorkersFromPresence,
  type WorkerPresence,
} from '@shared/types/worker-presence';

/** How often stale presence entries are re-checked between updates. */
const PRESENCE_RECHECK_MS = 30_000;

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
 * - GCP mode: Realtime Database presence for live worker updates (no
 *   Firestore reads). Queue depth via lightweight count query.
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
    } catch (err) {
      // Non-fatal: the queue depth just stays stale.
      reportHandledError(err, { action: 'fetchQueueDepth' });
    }
  }, []);

  // GCP mode: Realtime Database presence for workers
  useEffect(() => {
    if (!db || !rtdb || !enabled) return;

    // A worker that stops writing sends no update, so re-filter the last
    // snapshot on a timer to drop it once it goes stale.
    let entries: Record<string, WorkerPresence> | null = null;
    const publish = () => setWorkers(activeWorkersFromPresence(entries));

    const unsubscribe = onValue(ref(rtdb, PRESENCE_PATH), (snapshot) => {
      entries = snapshot.val();
      publish();
      setIsLoading(false);
    }, (err) => {
      reportHandledError(err, { action: 'subscribeWorkerPresence' });
      setIsLoading(false);
    });
    const recheck = setInterval(publish, PRESENCE_RECHECK_MS);

    // Fetch queue depth initially and every 15s
    fetchQueueDepth();
    const interval = setInterval(fetchQueueDepth, 15_000);

    return () => {
      unsubscribe();
      clearInterval(recheck);
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
