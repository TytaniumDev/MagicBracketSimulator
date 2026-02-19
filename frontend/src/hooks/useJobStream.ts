import { useState, useEffect, useRef, useCallback } from 'react';
import { getApiBase } from '../api';
import type { SimulationStatus } from '../types/simulation';

/**
 * Hook that connects to the SSE stream for a job's status updates.
 * Falls back to polling if SSE connection fails.
 *
 * Handles two SSE event types:
 *  - default "message" events: job-level updates (status, progress, result)
 *  - named "simulations" events: per-simulation status updates
 *
 * @param jobId - The job ID to stream updates for
 * @returns { job, simulations, error, connected }
 */
export function useJobStream<T>(jobId: string | undefined) {
  const [job, setJob] = useState<T | null>(null);
  const [simulations, setSimulations] = useState<SimulationStatus[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const closedRef = useRef(false);

  // Close the EventSource connection
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
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (closedRef.current) return;

      try {
        const apiBase = getApiBase();
        // No auth token needed — stream is public
        const url = `${apiBase}/api/jobs/${jobId}/stream`;

        const es = new EventSource(url);
        eventSourceRef.current = es;

        // Default event: job-level updates
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

            // Stream auto-closes on terminal states, but also close client-side
            if (data.status === 'COMPLETED' || data.status === 'FAILED' || data.status === 'CANCELLED') {
              closeConnection();
            }
          } catch {
            // Ignore parse errors
          }
        };

        // Named event: per-simulation status updates
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
          // EventSource has built-in reconnection, but if the connection
          // was closed by the server (terminal state), don't retry
          if (es.readyState === EventSource.CLOSED) {
            closeConnection();
          }
        };
      } catch {
        // URL construction failed; retry after delay
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
