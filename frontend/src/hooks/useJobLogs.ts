import { useState, useEffect } from 'react';
import { getApiBase, fetchWithAuth } from '../api';
import { isTerminal } from '../utils/status';
import type { JobResponse } from '@shared/types/job';
import type { CondensedGame, StructuredGame } from '@shared/types/log';

interface UseJobLogsOptions {
  /** Whether the log panel is open (triggers raw + condensed fetching) */
  showLogPanel: boolean;
  /** Whether to load structured logs (user-triggered) */
  loadStructured: boolean;
}

export interface JobLogsData {
  rawLogs: string[] | null;
  rawLogsError: string | null;
  condensedLogs: CondensedGame[] | null;
  condensedError: string | null;
  structuredGames: StructuredGame[] | null;
  structuredError: string | null;
  /** Deck names extracted from structured logs */
  deckNames: string[] | null;
  /** Color identity by deck name (server-provided or fetched) */
  colorIdentityByDeckName: Record<string, string[]>;
}

/**
 * Manages all log data fetching: raw, condensed, structured logs
 * and color identity resolution.
 *
 * Lazy-loads data based on user interaction:
 * - Raw + condensed logs load when the log panel is opened
 * - Structured logs load when the user clicks "Load Deck Actions"
 * - Color identity is resolved from the server or fetched separately
 */
export function useJobLogs(
  jobId: string | undefined,
  job: JobResponse | null,
  options: UseJobLogsOptions,
): JobLogsData {
  const [rawLogs, setRawLogs] = useState<string[] | null>(null);
  const [rawLogsError, setRawLogsError] = useState<string | null>(null);
  const [condensedLogs, setCondensedLogs] = useState<CondensedGame[] | null>(null);
  const [condensedError, setCondensedError] = useState<string | null>(null);
  const [structuredGames, setStructuredGames] = useState<StructuredGame[] | null>(null);
  const [structuredError, setStructuredError] = useState<string | null>(null);
  const [deckNames, setDeckNames] = useState<string[] | null>(null);
  const [colorIdentityByDeckName, setColorIdentityByDeckName] = useState<Record<string, string[]>>({});

  const apiBase = getApiBase();

  // Fetch structured logs (deferred until user requests them)
  const jobStatus = job?.status;
  useEffect(() => {
    if (!jobId || !jobStatus || !options.loadStructured) return;
    if (!isTerminal(jobStatus)) return;
    if (structuredGames !== null) return; // Already fetched

    setStructuredError(null);
    fetchWithAuth(`${apiBase}/api/jobs/${jobId}/logs/structured`)
      .then((res) => {
        if (!res.ok) {
          if (res.status === 404) return { games: [], deckNames: [] };
          throw new Error('Failed to load structured logs');
        }
        return res.json();
      })
      .then((data) => {
        setStructuredGames(data.games ?? []);
        setDeckNames(data.deckNames ?? null);
      })
      .catch((err) => setStructuredError(err instanceof Error ? err.message : 'Unknown error'));
  }, [jobId, apiBase, jobStatus, structuredGames, options.loadStructured]);

  // Stable keys for color identity dependencies
  const deckNamesKey = job?.deckNames?.join(',') ?? '';
  const logDeckNamesKey = deckNames?.join(',') ?? '';
  const colorIdentityKey = JSON.stringify(job?.colorIdentity);

  // Resolve color identity (server-provided or separate fetch)
  useEffect(() => {
    if (!job) return;

    if (job.colorIdentity && Object.keys(job.colorIdentity).length > 0) {
      setColorIdentityByDeckName(job.colorIdentity);
      return;
    }

    const names = new Set<string>();
    job.deckNames?.forEach((n) => names.add(n));
    deckNames?.forEach((n) => names.add(n));
    const list = Array.from(names);
    if (list.length === 0) return;
    const params = new URLSearchParams({ names: list.join(',') });
    fetchWithAuth(`${apiBase}/api/deck-color-identity?${params}`)
      .then((res) => (res.ok ? res.json() : {}))
      .then((data: Record<string, string[]>) => setColorIdentityByDeckName(data))
      .catch((err) => console.error('Failed to fetch color identity:', err));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase, job?.id, deckNamesKey, logDeckNamesKey, colorIdentityKey]);

  // Fetch raw and condensed logs when log panel is opened
  useEffect(() => {
    if (!jobId || !options.showLogPanel) return;

    if (rawLogs === null) {
      setRawLogsError(null);
      fetchWithAuth(`${apiBase}/api/jobs/${jobId}/logs/raw`)
        .then((res) => {
          if (!res.ok) {
            if (res.status === 404) return { gameLogs: [] };
            throw new Error('Failed to load raw logs');
          }
          return res.json();
        })
        .then((data) => setRawLogs(data.gameLogs ?? []))
        .catch((err) => setRawLogsError(err instanceof Error ? err.message : 'Unknown error'));
    }

    if (condensedLogs === null) {
      setCondensedError(null);
      fetchWithAuth(`${apiBase}/api/jobs/${jobId}/logs/condensed`)
        .then((res) => {
          if (!res.ok) {
            if (res.status === 404) return { condensed: [] };
            throw new Error('Failed to load condensed logs');
          }
          return res.json();
        })
        .then((data) => setCondensedLogs(data.condensed ?? []))
        .catch((err) => setCondensedError(err instanceof Error ? err.message : 'Unknown error'));
    }
  }, [jobId, apiBase, options.showLogPanel, rawLogs, condensedLogs]);

  return {
    rawLogs,
    rawLogsError,
    condensedLogs,
    condensedError,
    structuredGames,
    structuredError,
    deckNames,
    colorIdentityByDeckName,
  };
}
