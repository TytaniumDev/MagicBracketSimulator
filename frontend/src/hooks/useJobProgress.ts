import { useState, useEffect, useRef, useCallback } from 'react';
import { ref, onValue } from 'firebase/database';
import { rtdb } from '../firebase';
import { getApiBase, getFirebaseIdToken } from '../api';
import { isTerminal } from '../utils/status';
import type { SimulationStatus } from '../types/simulation';

/**
 * Derive simulation index from simId (e.g., "sim_003" → 3).
 * Falls back to existingIndex if present, or 0 if simId doesn't match the pattern.
 */
function parseSimIndex(simId: string, existingIndex?: number): number {
  if (existingIndex != null) return existingIndex;
  const match = simId.match(/_(\d+)$/);
  return match ? parseInt(match[1], 10) : 0;
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
        // RTDB stores total game count as `totalGames` to avoid collision with the
        // `simulations/` subtree. Map it back to `simulations` for the Job type.
        if (jobData.totalGames != null && !('simulations' in jobData)) {
          (jobData as Record<string, unknown>).simulations = jobData.totalGames;
        }
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
          const sims: SimulationStatus[] = Object.entries(rtdbSims)
            .map(([simId, simData]) => ({
              simId,
              ...(simData as Record<string, unknown>),
              index: parseSimIndex(simId, (simData as Record<string, unknown>).index as number | undefined),
            }))
            .sort((a, b) => ((a as SimulationStatus).index ?? 0) - ((b as SimulationStatus).index ?? 0)) as SimulationStatus[];
          if (sims.length > 0) {
            markSimsReceived();
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

        // RTDB stores simulations as an object keyed by simId
        const sims: SimulationStatus[] = Object.entries(data)
          .map(([simId, simData]) => ({
            simId,
            ...(simData as Record<string, unknown>),
            index: parseSimIndex(simId, (simData as Record<string, unknown>).index as number | undefined),
          }))
          .sort((a, b) => ((a as SimulationStatus).index ?? 0) - ((b as SimulationStatus).index ?? 0)) as SimulationStatus[];

        markSimsReceived();
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
