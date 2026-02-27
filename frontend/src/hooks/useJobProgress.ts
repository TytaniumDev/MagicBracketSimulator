import { useState, useEffect, useRef, useCallback } from 'react';
import { ref, onValue } from 'firebase/database';
import { rtdb } from '../firebase';
import { getApiBase, getFirebaseIdToken } from '../api';
import { isTerminal } from '../utils/status';
import type { SimulationStatus } from '../types/simulation';

/**
 * Parse RTDB simulation entries into SimulationStatus objects.
 * Falls back to parsing `index` from simId (e.g. "sim_003" → 3) when RTDB data lacks it.
 * Filters out entries with unparseable simIds and sorts by index.
 */
export function parseRtdbSimulations(
  rtdbSims: Record<string, Record<string, unknown>>
): SimulationStatus[] {
  return Object.entries(rtdbSims)
    .map(([simId, simData]) => {
      let index = typeof simData.index === 'number' ? simData.index : undefined;
      if (index === undefined) {
        const match = simId.match(/^sim_(\d+)$/);
        if (match) {
          index = parseInt(match[1], 10);
        }
      }
      if (index === undefined) return null;
      return { simId, ...simData, index } as SimulationStatus;
    })
    .filter((s): s is SimulationStatus => s !== null)
    .sort((a, b) => a.index - b.index);
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

      // Poll simulations via REST as a fallback in case RTDB doesn't deliver them.
      // Polls every 3s; stops once sims arrive from any source or job is unsubscribed.
      let simsReceived = false;
      let simPollTimer: ReturnType<typeof setInterval> | null = null;
      simPollTimer = setInterval(() => {
        if (unsubscribed || simsReceived) {
          if (simPollTimer) { clearInterval(simPollTimer); simPollTimer = null; }
          return;
        }
        fetchSimsRest(jobId).then((sims) => {
          if (!unsubscribed && sims && sims.length > 0) {
            simsReceived = true;
            if (simPollTimer) { clearInterval(simPollTimer); simPollTimer = null; }
            setSimulations(sims);
          }
        });
      }, 3000);

      // Helper to mark sims as received (called when RTDB delivers sims)
      const markSimsReceived = () => {
        simsReceived = true;
        if (simPollTimer) { clearInterval(simPollTimer); simPollTimer = null; }
      };

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
        const { simulations: rtdbSims, ...jobData } = data;
        // RTDB stores id in the path, not the document — inject it
        (jobData as Record<string, unknown>).id = jobId;
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

        // Extract simulation statuses directly from the parent snapshot.
        // This is more reliable than the dedicated simsRef listener since
        // the parent snapshot always includes the full subtree.
        if (rtdbSims && typeof rtdbSims === 'object') {
          const sims = parseRtdbSimulations(rtdbSims as Record<string, Record<string, unknown>>);
          if (sims.length > 0) {
            // Only cancel REST polling if all sims have valid indices
            const hasValidIndices = sims.every(s => typeof s.index === 'number' && s.index >= 0);
            if (hasValidIndices) markSimsReceived();
            setSimulations(sims);
          }
        }

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

      // Simulations listener (belt-and-suspenders alongside parent extraction)
      cleanupSims = onValue(simsRef, (snapshot) => {
        if (unsubscribed) return;
        const data = snapshot.val();
        if (!data) return;

        const sims = parseRtdbSimulations(data as Record<string, Record<string, unknown>>);
        if (sims.length === 0) return;

        // Only cancel REST polling if all sims have valid indices (every() on empty is true, guarded above)
        const hasValidIndices = sims.every(s => typeof s.index === 'number' && s.index >= 0);
        if (hasValidIndices) markSimsReceived();
        setSimulations(sims);
      }, () => {
        // Non-fatal: simulation updates just won't appear
      });

      return () => {
        unsubAll();
        if (simPollTimer) { clearInterval(simPollTimer); simPollTimer = null; }
      };
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

/**
 * Fetch simulation statuses via REST API.
 * Fallback for when RTDB doesn't deliver simulation data.
 */
async function fetchSimsRest(jobId: string): Promise<SimulationStatus[] | null> {
  try {
    const apiBase = getApiBase();
    const token = await getFirebaseIdToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${apiBase}/api/jobs/${jobId}/simulations`, { headers });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data.simulations) ? data.simulations : null;
  } catch {
    return null;
  }
}
