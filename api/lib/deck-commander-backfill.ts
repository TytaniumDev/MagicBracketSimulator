/**
 * Fills in `primaryCommander` on user decks imported before deck creation
 * saved it (PR #613), so the Decks page shows their commander. Used by
 * scripts/backfill-deck-commanders.ts.
 */
import { parseCommanderFromContent } from './saved-decks';

export interface StoredUserDeck {
  id: string;
  name: string;
  dck: string;
  primaryCommander?: string | null;
}

export interface CommanderFix {
  id: string;
  name: string;
  primaryCommander: string;
}

/** The decks that have no stored commander but name one in their .dck. */
export function commanderFixes(decks: StoredUserDeck[]): CommanderFix[] {
  return decks.flatMap((deck) => {
    if (deck.primaryCommander) return [];
    const primaryCommander = parseCommanderFromContent(deck.dck);
    return primaryCommander ? [{ id: deck.id, name: deck.name, primaryCommander }] : [];
  });
}
