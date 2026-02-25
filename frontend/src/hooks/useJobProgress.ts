import { useState, useEffect, useRef, useCallback } from 'react';
import { ref, onValue } from 'firebase/database';
import { rtdb } from '../firebase';
import { getApiBase, getFirebaseIdToken } from '../api';
import type { SimulationStatus } from '../types/simulation';

function isTerminal(status: string | undefined): boolean {
  return status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED';
}

/**
 * Hook for real-time job progress updates.
 *
 * GCP mode (rtdb available): Listens to Firebase RTDB directly via onValue.
 *   - No SSE connection to Cloud Run — zero persistent server connections.
 *   - Firebase SDK handles auth, reconnection, and cleanup automatically.
 *   - Falls back to REST polling for terminal jobs (RTDB data is deleted on completion).
 *
 * LOCAL mode (rtdb is null): Falls back to SSE stream from the API.
 */
export function useJobProgress<T>(jobId: string | undefined) {
  const [job, setJob] = useState<T | null>(null);
  const [simulations, setSimulations] = useState<SimulationStatus[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const closedRef = useRef(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  const closeConnection = useCallback(() => {
    closedRef.current = true;
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!jobId) return;
    closedRef.current = false;

    // ─── GCP mode: listen to RTDB directly ──────────────────────────────
    if (rtdb) {
      const jobRef = ref(rtdb, `jobs/${jobId}`);
      const simsRef = ref(rtdb, `jobs/${jobId}/simulations`);
      let unsubscribed = false;

      // Store unsubscribe functions for cleanup
      let cleanupJob: (() => void) | null = null;
      let cleanupSims: (() => void) | null = null;

      const unsubAll = () => {
        unsubscribed = true;
        cleanupJob?.();
        cleanupSims?.();
      };

      // Fetch full job from REST to establish base state. RTDB only has
      // ephemeral progress fields and lacks id, name, simulations count, etc.
      fetchJobRest(jobId).then((restJob) => {
        if (unsubscribed || !restJob) return;
        setJob(prev => {
          if (!prev) return restJob as T;
          // RTDB already fired — layer REST underneath so real-time fields win
          return { ...(restJob as T), ...prev };
        });
        setConnected(true);
      });

      // Job-level listener
      cleanupJob = onValue(jobRef, (snapshot) => {
        if (unsubscribed) return;
        const data = snapshot.val();
        if (!data) {
          // RTDB data was deleted (job completed) or doesn't exist yet.
          // Fall back to REST to get the final state.
          fetchJobRest(jobId).then((restJob) => {
            if (restJob) {
              setJob(restJob as T);
              setConnected(true);
            }
          });
          return;
        }
        // Strip the `simulations` child — RTDB subtree includes it as a nested
        // object, but our Job type expects `simulations` to be a number.
        // Simulation data is handled by the dedicated simsRef listener below.
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { simulations: _rtdbSims, ...jobData } = data;
        setJob(prev => {
          if (!prev) return jobData as T;
          const merged = { ...prev };
          for (const [key, value] of Object.entries(jobData)) {
            if (value !== undefined) {
              (merged as Record<string, unknown>)[key] = value;
            }
          }
          return merged;
        });
        setConnected(true);
        setError(null);

        if (isTerminal(data.status)) {
          // Job is done — unsubscribe from RTDB
          unsubAll();
          // Fetch final state from REST for complete data (deckLinks, durationMs, etc.)
          fetchJobRest(jobId).then((restJob) => {
            if (restJob) setJob(restJob as T);
          });
        }
      }, (err) => {
        console.error('[useJobProgress] RTDB job listener error:', err);
        setError('Connection error');
        setConnected(false);
      });

      // Simulations listener
      cleanupSims = onValue(simsRef, (snapshot) => {
        if (unsubscribed) return;
        const data = snapshot.val();
        if (!data) return;

        // RTDB stores simulations as an object keyed by simId
        const sims: SimulationStatus[] = Object.entries(data)
          .map(([simId, simData]) => ({
            simId,
            ...(simData as Record<string, unknown>),
          }))
          .sort((a, b) => ((a as SimulationStatus).index ?? 0) - ((b as SimulationStatus).index ?? 0)) as SimulationStatus[];

        setSimulations(sims);
      }, () => {
        // Non-fatal: simulation updates just won't appear
      });

      return () => unsubAll();
    }

    // ─── LOCAL mode: SSE fallback ───────────────────────────────────────
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;

    const connect = async () => {
      if (closedRef.current) return;

      try {
        const apiBase = getApiBase();
        const token = await getFirebaseIdToken();
        const url = `${apiBase}/api/jobs/${jobId}/stream?token=${encodeURIComponent(token || '')}`;

        const es = new EventSource(url);
        eventSourceRef.current = es;

        es.onmessage = (event) => {
          if (closedRef.current) return;
          try {
            const data = JSON.parse(event.data);
            if (data.error) {
              setError(data.error);
              closeConnection();
              return;
            }
            setJob(data as T);
            setConnected(true);
            setError(null);

            if (isTerminal(data.status)) {
              setTimeout(() => closeConnection(), 500);
            }
          } catch {
            // Ignore parse errors
          }
        };

        es.addEventListener('simulations', (event) => {
          if (closedRef.current) return;
          try {
            const data = JSON.parse((event as MessageEvent).data);
            if (Array.isArray(data.simulations)) {
              setSimulations(data.simulations);
            }
          } catch {
            // Ignore parse errors
          }
        });

        es.onerror = () => {
          if (closedRef.current) return;
          setConnected(false);
          if (es.readyState === EventSource.CLOSED) {
            closeConnection();
          }
        };
      } catch {
        if (!closedRef.current) {
          retryTimeout = setTimeout(connect, 5000);
        }
      }
    };

    connect();

    return () => {
      closedRef.current = true;
      if (retryTimeout) clearTimeout(retryTimeout);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [jobId, closeConnection]);

  return { job, simulations, error, connected };
}

/**
 * Fetch job data via REST API (used for terminal jobs after RTDB cleanup).
 */
async function fetchJobRest(jobId: string): Promise<unknown | null> {
  try {
    const apiBase = getApiBase();
    const token = await getFirebaseIdToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${apiBase}/api/jobs/${jobId}`, { headers });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
