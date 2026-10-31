import { useCallback, useMemo } from 'react';
import type { LibraryDeck } from '../api';
import { cardKey, type ScryfallCard } from '../scryfall';
import { useScryfallCards } from './useDeck';

/**
 * Scryfall data for every deck's commander, in one batched lookup. Returns
 * a function from deck to its commander's card (undefined while loading or
 * when Scryfall doesn't know the name).
 */
export function useCommanderCards(decks: LibraryDeck[]): (deck: LibraryDeck) => ScryfallCard | undefined {
  const names = useMemo(
    () => [...new Set(decks.map((d) => d.primaryCommander).filter((n): n is string => !!n))],
    [decks],
  );
  const { data: lookup } = useScryfallCards(names);
  return useCallback(
    (deck: LibraryDeck) => (deck.primaryCommander ? lookup?.[cardKey(deck.primaryCommander)] : undefined),
    [lookup],
  );
}
