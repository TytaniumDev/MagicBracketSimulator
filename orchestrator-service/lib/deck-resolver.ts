import { DeckSlot } from './types';
import { readPreconContent } from './precons';
import { readSavedDeckContent } from './saved-decks';

/**
 * Resolve a deck ID to a DeckSlot.
 * The ID can be either:
 * - A precon ID (e.g., "lorehold-legacies")
 * - A saved deck filename (e.g., "my-deck.dck")
 *
 * Returns the DeckSlot or undefined if not found.
 */
export function resolveDeckId(deckId: string): DeckSlot | undefined {
  // Try precon first
  const preconContent = readPreconContent(deckId);
  if (preconContent) {
    return preconContent;
  }

  // Try saved deck
  const savedContent = readSavedDeckContent(deckId);
  if (savedContent) {
    return savedContent;
  }

  return undefined;
}

/**
 * Resolve multiple deck IDs to DeckSlots.
 * Returns { decks, errors } where errors is an array of IDs that couldn't be resolved.
 */
export function resolveDeckIds(deckIds: string[]): { decks: DeckSlot[]; errors: string[] } {
  const decks: DeckSlot[] = [];
  const errors: string[] = [];

  for (const id of deckIds) {
    const deck = resolveDeckId(id);
    if (deck) {
      decks.push(deck);
    } else {
      errors.push(id);
    }
  }

  return { decks, errors };
}
