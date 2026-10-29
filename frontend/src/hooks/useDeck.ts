import { useQuery } from '@tanstack/react-query';
import { fetchDeck, fetchDeckCardImpact } from '../api';
import { fetchScryfallCards } from '../scryfall';

/** One deck with its decklist and results, or nothing while `id` is undefined. */
export function useDeck(id: string | undefined) {
  return useQuery({
    queryKey: ['deck', id],
    queryFn: () => fetchDeck(id!),
    enabled: id != null,
    retry: 1,
  });
}

/** Per-card impact scores for a deck. */
export function useDeckCardImpact(id: string | undefined) {
  return useQuery({
    queryKey: ['deckCardImpact', id],
    queryFn: () => fetchDeckCardImpact(id!),
    enabled: id != null,
    retry: 1,
  });
}

/** Card printings don't change, so Scryfall data never needs re-reading in a session. */
const SCRYFALL_STALE_MS = Infinity;

/** Scryfall details for a set of card names, keyed by `cardKey`. */
export function useScryfallCards(names: string[]) {
  return useQuery({
    queryKey: ['scryfall', [...names].sort()],
    queryFn: () => fetchScryfallCards(names),
    enabled: names.length > 0,
    staleTime: SCRYFALL_STALE_MS,
    retry: 1,
  });
}
