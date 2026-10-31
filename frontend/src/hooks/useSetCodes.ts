import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchScryfallSets, setCodeFor } from '../scryfall-sets';

/** Sets change a few times a year, so one read per session is plenty. */
const SETS_STALE_MS = Infinity;

/** Look up a precon set's code ("TDM"); null until sets load or when unknown. */
export function useSetCodes(): (setName: string | null | undefined) => string | null {
  const { data: sets } = useQuery({
    queryKey: ['scryfallSets'],
    queryFn: fetchScryfallSets,
    staleTime: SETS_STALE_MS,
    retry: 1,
  });
  return useCallback((setName) => (sets ? setCodeFor(setName, sets) : null), [sets]);
}
