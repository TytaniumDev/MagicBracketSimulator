import type { DeckCard } from '@shared/types/deck';
import type { CardLookup } from '../scryfall';

/**
 * The set a deck's cards default to: a precon's cards were all printed in
 * the precon's set, which is its commander's. Custom decks have none.
 */
export function deckDefaultSet(isPrecon: boolean, commanders: DeckCard[]): string | undefined {
  return isPrecon ? commanders.find((c) => c.setCode)?.setCode : undefined;
}

/**
 * What to look up on Scryfall for each decklist card: its own printing, or
 * the deck's default set when the list doesn't name one.
 */
export function cardLookups(cards: DeckCard[], defaultSet: string | undefined): CardLookup[] {
  return cards.map(({ name, setCode, collectorNumber }) =>
    setCode ? { name, setCode, collectorNumber } : { name, setCode: defaultSet },
  );
}
