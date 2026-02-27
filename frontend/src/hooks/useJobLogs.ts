import { useQuery } from '@tanstack/react-query';
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
  rawLogsLoading: boolean;
  condensedLogs: CondensedGame[] | null;
  condensedError: string | null;
  condensedLoading: boolean;
  structuredGames: StructuredGame[] | null;
  structuredError: string | null;
  structuredLoading: boolean;
  /** Deck names extracted from structured logs */
  deckNames: string[] | null;
  /** Color identity by deck name (server-provided or fetched) */
  colorIdentityByDeckName: Record<string, string[]>;
}

/**
 * Manages all log data fetching using TanStack Query.
 *
 * Lazy-loads data based on user interaction:
 * - Raw + condensed logs load when the log panel is opened
 * - Structured logs load when the user clicks "Load Deck Actions"
 * - Color identity is resolved from the job or fetched separately
 */
export function useJobLogs(
  jobId: string | undefined,
  job: JobResponse | null,
  options: UseJobLogsOptions,
): JobLogsData {
  const apiBase = getApiBase();
  const jobStatus = job?.status;
  const terminal = isTerminal(jobStatus);

  const rawLogsQuery = useQuery({
    queryKey: ['job', jobId, 'logs', 'raw'],
    queryFn: async () => {
      const res = await fetchWithAuth(`${apiBase}/api/jobs/${jobId}/logs/raw`);
      if (!res.ok) {
        if (res.status === 404) return { gameLogs: [] };
        throw new Error('Failed to load raw logs');
      }
      return res.json();
    },
    enabled: !!jobId && terminal && options.showLogPanel,
    staleTime: Infinity,
  });

  const condensedQuery = useQuery({
    queryKey: ['job', jobId, 'logs', 'condensed'],
    queryFn: async () => {
      const res = await fetchWithAuth(`${apiBase}/api/jobs/${jobId}/logs/condensed`);
      if (!res.ok) {
        if (res.status === 404) return { condensed: [] };
        throw new Error('Failed to load condensed logs');
      }
      return res.json();
    },
    enabled: !!jobId && terminal && options.showLogPanel,
    staleTime: Infinity,
  });

  const structuredQuery = useQuery({
    queryKey: ['job', jobId, 'logs', 'structured'],
    queryFn: async () => {
      const res = await fetchWithAuth(`${apiBase}/api/jobs/${jobId}/logs/structured`);
      if (!res.ok) {
        if (res.status === 404) return { games: [], deckNames: [] };
        throw new Error('Failed to load structured logs');
      }
      return res.json();
    },
    enabled: !!jobId && terminal && options.loadStructured,
    staleTime: Infinity,
  });

  // Collect deck names from all sources
  const structuredDeckNames: string[] | null = structuredQuery.data?.deckNames ?? null;

  // Build the names list for color identity lookup
  const allDeckNames = new Set<string>();
  job?.deckNames?.forEach((n) => allDeckNames.add(n));
  structuredDeckNames?.forEach((n) => allDeckNames.add(n));
  const namesList = Array.from(allDeckNames).sort();

  // Color identity: prefer job-level data, fall back to separate fetch
  const jobHasColorIdentity = !!job?.colorIdentity && Object.keys(job.colorIdentity).length > 0;

  const colorIdentityQuery = useQuery({
    queryKey: ['colorIdentity', jobId, ...namesList],
    queryFn: async () => {
      const params = new URLSearchParams({ names: namesList.join(',') });
      const res = await fetchWithAuth(`${apiBase}/api/deck-color-identity?${params}`);
      if (!res.ok) return {};
      return res.json() as Promise<Record<string, string[]>>;
    },
    enabled: !!jobId && namesList.length > 0 && !jobHasColorIdentity,
    staleTime: Infinity,
  });

  const colorIdentityByDeckName = jobHasColorIdentity
    ? job!.colorIdentity!
    : (colorIdentityQuery.data ?? {});

  return {
    rawLogs: rawLogsQuery.data?.gameLogs ?? null,
    rawLogsError: rawLogsQuery.error?.message ?? null,
    rawLogsLoading: rawLogsQuery.isLoading && rawLogsQuery.fetchStatus !== 'idle',
    condensedLogs: condensedQuery.data?.condensed ?? null,
    condensedError: condensedQuery.error?.message ?? null,
    condensedLoading: condensedQuery.isLoading && condensedQuery.fetchStatus !== 'idle',
    structuredGames: structuredQuery.data?.games ?? null,
    structuredError: structuredQuery.error?.message ?? null,
    structuredLoading: structuredQuery.isLoading && structuredQuery.fetchStatus !== 'idle',
    deckNames: structuredDeckNames,
    colorIdentityByDeckName,
  };
}
