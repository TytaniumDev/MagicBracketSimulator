import { useState, useEffect, useRef, useCallback } from 'react';
import { getApiBase, getFirebaseIdToken } from '../api';

/**
 * Hook that connects to the SSE stream for a job's status updates.
 * Falls back to polling if SSE connection fails.
 *
 * @param jobId - The job ID to stream updates for
 * @returns { job, error, connected } - The latest job data, any error, and connection status
 */
export function useJobStream<T>(jobId: string | undefined) {
  const [job, setJob] = useState<T | null>(null);
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

    const connect = async () => {
      if (closedRef.current) return;

      try {
        const apiBase = getApiBase();
        const token = await getFirebaseIdToken();
        const url = new URL(`${apiBase}/api/jobs/${jobId}/stream`);
        if (token) {
          url.searchParams.set('token', token);
        }

        const es = new EventSource(url.toString());
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

            // Stream auto-closes on terminal states, but also close client-side
            if (data.status === 'COMPLETED' || data.status === 'FAILED') {
              closeConnection();
            }
          } catch {
            // Ignore parse errors
          }
        };

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
        // Token fetch or URL construction failed; retry after delay
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

  return { job, error, connected };
}
