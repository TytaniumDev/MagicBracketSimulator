import { describe, it, expect } from 'vitest';
import { COMMUNITY_GROUP_TITLE, groupDecksBySet } from './deck-groups';
import type { LibraryDeck } from '../api';

function makeDeck(overrides: Partial<LibraryDeck> = {}): LibraryDeck {
  return {
    id: 'deck',
    name: 'Deck',
    filename: 'deck.dck',
    isPrecon: true,
    ownerId: null,
    ...overrides,
  };
}

describe('groupDecksBySet', () => {
  it('puts community decks first, then sets newest first', () => {
    const groups = groupDecksBySet([
      makeDeck({ id: 'a', name: 'Tinker Time', setName: 'March of the Machine', releasedAt: '2023-04-06' }),
      makeDeck({ id: 'b', name: 'Mine', isPrecon: false, ownerId: 'u1' }),
      makeDeck({ id: 'c', name: 'Klingon Fury', setName: 'Star Trek', releasedAt: '2026-10-28' }),
    ]);
    expect(groups.map((g) => g.title)).toEqual([COMMUNITY_GROUP_TITLE, 'Star Trek', 'March of the Machine']);
  });

  it('dates a set by its newest precon and sorts decks by name', () => {
    const [group] = groupDecksBySet([
      makeDeck({ id: 'a', name: 'Wretched Ranks', setName: 'Foundations', releasedAt: '2026-09-18' }),
      makeDeck({ id: 'b', name: 'Calling All Angels', setName: 'Foundations', releasedAt: '2026-09-20' }),
    ]);
    expect(group.releasedAt).toBe('2026-09-20');
    expect(group.decks.map((d) => d.name)).toEqual(['Calling All Angels', 'Wretched Ranks']);
  });

  it('groups precons without a set together, after dated sets', () => {
    const groups = groupDecksBySet([
      makeDeck({ id: 'a', name: '20 Ways to Win', setName: null }),
      makeDeck({ id: 'b', name: 'Tinker Time', setName: 'March of the Machine', releasedAt: '2023-04-06' }),
    ]);
    expect(groups.map((g) => g.title)).toEqual(['March of the Machine', 'Other Precons']);
  });

  it('omits the community group when there are no community decks', () => {
    expect(groupDecksBySet([])).toEqual([]);
  });
});
