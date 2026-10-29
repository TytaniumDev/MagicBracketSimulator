import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchDeckLibrary, setDeckExcluded, type DeckLibrary } from '../api';

const DECK_LIBRARY_KEY = ['deckLibrary'];

/** Every deck (precons and community) plus which are excluded from selection. */
export function useDeckLibrary() {
  return useQuery({
    queryKey: DECK_LIBRARY_KEY,
    queryFn: fetchDeckLibrary,
  });
}

/** Exclude a deck from selection or include it again, updating the cached library. */
export function useSetDeckExcluded() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['setDeckExcluded'],
    mutationFn: ({ deckId, excluded }: { deckId: string; excluded: boolean }) =>
      setDeckExcluded(deckId, excluded),
    onSuccess: (excludedDeckIds) => {
      queryClient.setQueryData<DeckLibrary>(DECK_LIBRARY_KEY, (prev) =>
        prev && { ...prev, excludedDeckIds },
      );
    },
  });
}
