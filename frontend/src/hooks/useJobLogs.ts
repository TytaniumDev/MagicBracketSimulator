import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { getApiBase, fetchWithAuth } from '../api';
import { isTerminal } from '../utils/status';
import type { JobResponse } from '@shared/types/job';
import type { GameListResponse, GameLogResponse, GameSummary } from '@shared/types/log';

interface UseJobLogsOptions {
  /** Whether the person opened a log view (Deck Actions or the detailed logs). */
  enabled: boolean;
  /** The game to load, counted from 0 in play order. */
  selectedGame: number;
}

export interface JobLogsData {
  /** Every game's outcome, in play order. */
  games: GameSummary[] | null;
  gamesError: string | null;
  gamesLoading: boolean;
  /** The selected game's raw log with its condensed and structured views. */
  game: GameLogResponse | null;
  gameError: string | null;
  gameLoading: boolean;
  /** Deck names stored with the job's logs */
  deckNames: string[] | null;
  /** Color identity by deck name (server-provided or fetched) */
  colorIdentityByDeckName: Record<string, string[]>;
}

/**
 * Manages all log data fetching using TanStack Query.
 *
 * Lazy-loads data based on user interaction: once a log view is opened it
 * loads the job's game list, then only the selected game's logs, so a
 * 1000-game job never downloads every log at once.
 * Color identity is resolved from the job or fetched separately.
 */
export function useJobLogs(
  jobId: string | undefined,
  job: JobResponse | null,
  options: UseJobLogsOptions,
): JobLogsData {
  const apiBase = getApiBase();
  const jobStatus = job?.status;
  const terminal = isTerminal(jobStatus);

  const gamesQuery = useQuery({
    queryKey: ['job', jobId, 'logs', 'games'],
    queryFn: async (): Promise<GameListResponse> => {
      const res = await fetchWithAuth(`${apiBase}/api/jobs/${jobId}/logs/games`);
      if (!res.ok) {
        if (res.status === 404) return { games: [] };
        throw new Error('Failed to load game list');
      }
      return res.json();
    },
    enabled: !!jobId && terminal && options.enabled,
    staleTime: Infinity,
  });

  const gameCount = gamesQuery.data?.games.length ?? 0;
  const gameQuery = useQuery({
    queryKey: ['job', jobId, 'logs', 'games', options.selectedGame],
    queryFn: async (): Promise<GameLogResponse> => {
      const res = await fetchWithAuth(`${apiBase}/api/jobs/${jobId}/logs/games/${options.selectedGame}`);
      if (!res.ok) throw new Error('Failed to load game logs');
      return res.json();
    },
    enabled: !!jobId && terminal && options.enabled && options.selectedGame < gameCount,
    staleTime: Infinity,
    // Keep showing the last game while the next one loads, so the view doesn't blink.
    placeholderData: keepPreviousData,
  });

  // Collect deck names from all sources
  const structuredDeckNames: string[] | null = gamesQuery.data?.deckNames ?? null;

  // Build the names list for color identity lookup
  const allDeckNames = new Set<string>();
  job?.seats.forEach((s) => allDeckNames.add(s.name));
  structuredDeckNames?.forEach((n) => allDeckNames.add(n));
  const namesList = Array.from(allDeckNames).sort();

  // Color identity: prefer the seats' colors, fall back to a separate fetch
  const jobColorIdentity: Record<string, string[]> = {};
  for (const seat of job?.seats ?? []) {
    if (seat.colorIdentity.length > 0) jobColorIdentity[seat.name] = seat.colorIdentity;
  }
  const jobHasColorIdentity = Object.keys(jobColorIdentity).length > 0;

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
    ? jobColorIdentity
    : (colorIdentityQuery.data ?? {});

  return {
    games: gamesQuery.data?.games ?? null,
    gamesError: gamesQuery.error?.message ?? null,
    gamesLoading: gamesQuery.isLoading && gamesQuery.fetchStatus !== 'idle',
    game: gameQuery.data ?? null,
    gameError: gameQuery.error?.message ?? null,
    gameLoading: gameQuery.isLoading && gameQuery.fetchStatus !== 'idle',
    deckNames: structuredDeckNames,
    colorIdentityByDeckName,
  };
}
