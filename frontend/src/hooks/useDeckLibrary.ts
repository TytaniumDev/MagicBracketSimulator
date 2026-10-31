import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchDeckLibrary, setDecksExcluded, type DeckLibrary } from '../api';

const DECK_LIBRARY_KEY = ['deckLibrary'];
const SET_EXCLUDED_KEY = ['setDecksExcluded'];

/** Every deck (precons and community) plus which are excluded from selection. */
export function useDeckLibrary() {
  return useQuery({
    queryKey: DECK_LIBRARY_KEY,
    queryFn: fetchDeckLibrary,
  });
}

/** `ids` with `deckIds` added (excluded) or removed (included). */
function withExclusion(ids: string[], deckIds: string[], excluded: boolean): string[] {
  const next = new Set(ids);
  for (const id of deckIds) {
    if (excluded) next.add(id);
    else next.delete(id);
  }
  return [...next];
}

/**
 * Exclude decks from selection or include them again. The cached library
 * changes at once and the save runs behind it; a failed save puts those
 * decks back as they were (the mutation cache reports the error to Sentry).
 */
export function useSetDecksExcluded() {
  const queryClient = useQueryClient();
  const updateExcluded = (update: (ids: string[]) => string[]) =>
    queryClient.setQueryData<DeckLibrary>(DECK_LIBRARY_KEY, (prev) =>
      prev && { ...prev, excludedDeckIds: update(prev.excludedDeckIds) },
    );

  return useMutation({
    mutationKey: SET_EXCLUDED_KEY,
    mutationFn: ({ deckIds, excluded }: { deckIds: string[]; excluded: boolean }) =>
      setDecksExcluded(deckIds, excluded),
    onMutate: async ({ deckIds, excluded }) => {
      // A library fetch already in flight would overwrite the change.
      await queryClient.cancelQueries({ queryKey: DECK_LIBRARY_KEY });
      const before = new Set(queryClient.getQueryData<DeckLibrary>(DECK_LIBRARY_KEY)?.excludedDeckIds);
      updateExcluded((ids) => withExclusion(ids, deckIds, excluded));
      return { wasExcluded: deckIds.filter((id) => before.has(id)) };
    },
    onError: (_error, { deckIds }, context) => {
      updateExcluded((ids) => withExclusion(withExclusion(ids, deckIds, false), context?.wasExcluded ?? [], true));
    },
    onSuccess: (excludedDeckIds) => {
      // While other saves are still running, their changes aren't in this
      // answer yet, so only the last one takes the server's list.
      if (queryClient.isMutating({ mutationKey: SET_EXCLUDED_KEY }) === 1) {
        updateExcluded(() => excludedDeckIds);
      }
    },
  });
}
