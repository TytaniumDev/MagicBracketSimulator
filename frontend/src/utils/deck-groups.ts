import type { LibraryDeck } from '../api';

export interface DeckGroup {
  /** Set name for precons, "Community Decks" for user decks. */
  title: string;
  /** Release date of the set's newest precon (YYYY-MM-DD), null when unknown. */
  releasedAt: string | null;
  decks: LibraryDeck[];
}

export const COMMUNITY_GROUP_TITLE = 'Community Decks';
const UNKNOWN_SET_TITLE = 'Other Precons';

/**
 * Group decks the way Archidekt lists precons: community decks first, then
 * one group per precon set, newest set first. Decks within a group are
 * sorted by name.
 */
export function groupDecksBySet(decks: LibraryDeck[]): DeckGroup[] {
  const community: LibraryDeck[] = [];
  const sets = new Map<string, DeckGroup>();

  for (const deck of decks) {
    if (!deck.isPrecon) {
      community.push(deck);
      continue;
    }
    const title = deck.setName || UNKNOWN_SET_TITLE;
    const group = sets.get(title) ?? { title, releasedAt: null, decks: [] };
    group.decks.push(deck);
    if (deck.releasedAt && (!group.releasedAt || deck.releasedAt > group.releasedAt)) {
      group.releasedAt = deck.releasedAt;
    }
    sets.set(title, group);
  }

  const byName = (a: LibraryDeck, b: LibraryDeck) => a.name.localeCompare(b.name);
  const precons = [...sets.values()]
    .map((g) => ({ ...g, decks: g.decks.sort(byName) }))
    .sort(
      (a, b) =>
        (b.releasedAt ?? '').localeCompare(a.releasedAt ?? '') || a.title.localeCompare(b.title),
    );

  return community.length > 0
    ? [{ title: COMMUNITY_GROUP_TITLE, releasedAt: null, decks: community.sort(byName) }, ...precons]
    : precons;
}
