import type { LibraryDeck } from '../api';
import { COMMUNITY_GROUP_TITLE, groupDecksBySet } from './deck-groups';

export type DeckSort = 'set' | 'newest' | 'oldest' | 'name';

export const DECK_SORT_OPTIONS: { value: DeckSort; label: string }[] = [
  { value: 'set', label: 'By set' },
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'name', label: 'Name' },
];

export interface DeckSection {
  title: string;
  /** The precon set this section holds, for its set code; null otherwise. */
  setName: string | null;
  /** The set's release date (YYYY-MM-DD), shown as a year; null otherwise. */
  releasedAt: string | null;
  decks: LibraryDeck[];
}

const PRECON_SECTION_TITLE = 'Preconstructed Decks';

const byName = (a: LibraryDeck, b: LibraryDeck) => a.name.localeCompare(b.name);

/** Release date order; decks without a date (community decks) go last, by name. */
function byRelease(direction: 1 | -1) {
  return (a: LibraryDeck, b: LibraryDeck) => {
    if (a.releasedAt && b.releasedAt) return direction * a.releasedAt.localeCompare(b.releasedAt) || byName(a, b);
    if (a.releasedAt || b.releasedAt) return a.releasedAt ? -1 : 1;
    return byName(a, b);
  };
}

const COMPARATORS: Record<Exclude<DeckSort, 'set'>, (a: LibraryDeck, b: LibraryDeck) => number> = {
  newest: byRelease(-1),
  oldest: byRelease(1),
  name: byName,
};

/**
 * The picker's sections for a sort. "By set" gives one section per precon
 * set, newest set first; the others give one section of precons in that
 * order. Community decks always come first in their own section.
 */
export function orderDecks(decks: LibraryDeck[], sort: DeckSort): DeckSection[] {
  if (sort === 'set') {
    return groupDecksBySet(decks).map((group) => ({
      title: group.title,
      setName: group.title === COMMUNITY_GROUP_TITLE ? null : (group.decks[0]?.setName ?? null),
      releasedAt: group.releasedAt,
      decks: group.decks,
    }));
  }
  const compare = COMPARATORS[sort];
  const community = decks.filter((d) => !d.isPrecon).sort(compare);
  const precons = decks.filter((d) => d.isPrecon).sort(compare);
  return [
    { title: COMMUNITY_GROUP_TITLE, setName: null, releasedAt: null, decks: community },
    { title: PRECON_SECTION_TITLE, setName: null, releasedAt: null, decks: precons },
  ].filter((s) => s.decks.length > 0);
}
