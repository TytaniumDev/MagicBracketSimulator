import { DeckSlot } from './types';
import { readDeckContent } from './deck-store-factory';

/**
 * Resolve a deck ID to a DeckSlot.
 * Uses unified deck store (precons + user decks); no special precon logic.
 *
 * Returns the DeckSlot or undefined if not found.
 */
export async function resolveDeckId(deckId: string): Promise<DeckSlot | undefined> {
  const content = await readDeckContent(deckId);
  return content ?? undefined;
}

/**
 * Resolve multiple deck IDs to DeckSlots.
 * Returns { decks, errors } where errors is an array of IDs that couldn't be resolved.
 */
export async function resolveDeckIds(
  deckIds: string[]
): Promise<{ decks: DeckSlot[]; errors: string[] }> {
  const decks: DeckSlot[] = [];
  const errors: string[] = [];

  for (const id of deckIds) {
    const deck = await resolveDeckId(id);
    if (deck) {
      decks.push(deck);
    } else {
      errors.push(id);
    }
  }

  return { decks, errors };
}
