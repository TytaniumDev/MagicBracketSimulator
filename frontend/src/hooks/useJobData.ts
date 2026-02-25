import { useState, useEffect, useRef } from 'react';
import { getApiBase, fetchWithAuth } from '../api';
import { useJobProgress } from './useJobProgress';
import type { JobResponse } from '@shared/types/job';
import type { SimulationStatus } from '@shared/types/simulation';

function isTerminal(status: string | undefined): boolean {
  return status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED';
}

/**
 * Consolidates all job data fetching: RTDB/SSE streaming + REST fallback
 * polling + simulation status fallback for terminal jobs.
 *
 * Returns a single, stable interface regardless of which data source
 * is active under the hood.
 */
export function useJobData(jobId: string | undefined) {
  const [job, setJob] = useState<JobResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fallbackSimulations, setFallbackSimulations] = useState<SimulationStatus[]>([]);
  const fallbackIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const apiBase = getApiBase();

  // Primary: RTDB (GCP) or SSE (local) for real-time job updates
  const {
    job: streamJob,
    simulations: rawStreamSimulations,
    error: streamError,
    connected: sseConnected,
  } = useJobProgress<JobResponse>(jobId);

  // Merge SSE simulations with REST fallback
  const simulations = rawStreamSimulations.length > 0 ? rawStreamSimulations : fallbackSimulations;

  // Sync SSE data into component state
  useEffect(() => {
    if (streamJob) setJob(streamJob);
  }, [streamJob]);

  useEffect(() => {
    if (streamError) setError(streamError);
  }, [streamError]);

  // Fallback: Poll if SSE hasn't connected within 5 seconds
  useEffect(() => {
    if (!jobId || sseConnected) return;

    const controller = new AbortController();
    let fallbackActive = false;

    const timeoutId = setTimeout(() => {
      fallbackActive = true;
      const fetchJob = () => {
        fetchWithAuth(`${apiBase}/api/jobs/${jobId}`, { signal: controller.signal })
          .then((res) => {
            if (!res.ok) {
              if (res.status === 404) throw new Error('Job not found');
              throw new Error('Failed to load job');
            }
            return res.json();
          })
          .then((data) => {
            setJob(data);
            if (isTerminal(data.status)) {
              if (fallbackIntervalRef.current) {
                clearInterval(fallbackIntervalRef.current);
                fallbackIntervalRef.current = null;
              }
            }
          })
          .catch((err) => {
            if (err.name !== 'AbortError') setError(err.message);
          });
      };
      fetchJob();
      fallbackIntervalRef.current = setInterval(fetchJob, 5000);
    }, 5000);

    return () => {
      clearTimeout(timeoutId);
      if (fallbackActive && fallbackIntervalRef.current) {
        clearInterval(fallbackIntervalRef.current);
        fallbackIntervalRef.current = null;
      }
      controller.abort();
    };
  }, [jobId, apiBase, sseConnected]);

  // Fetch simulation statuses via REST for terminal jobs
  useEffect(() => {
    if (!jobId || !job) return;
    if (!isTerminal(job.status)) return;
    if (simulations.length > 0) return; // Already have them

    fetchWithAuth(`${apiBase}/api/jobs/${jobId}/simulations`)
      .then((res) => {
        if (!res.ok) return { simulations: [] };
        return res.json();
      })
      .then((data) => {
        if (Array.isArray(data.simulations) && data.simulations.length > 0) {
          setFallbackSimulations(data.simulations);
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, apiBase, job?.status]);

  return { job, setJob, simulations, error, setError };
}
