import { describe, it, expect } from 'vitest';
import type { LibraryDeck } from '../api';
import { orderDecks } from './deck-order';

const deck = (name: string, overrides: Partial<LibraryDeck> = {}): LibraryDeck => ({
  id: name.toLowerCase(),
  name,
  filename: `${name}.dck`,
  isPrecon: true,
  ownerId: null,
  ...overrides,
});

const DECKS = [
  deck('Animated Army', { setName: 'Bloomburrow', releasedAt: '2024-08-02' }),
  deck('Abzan Armor', { setName: 'Tarkir: Dragonstorm', releasedAt: '2025-04-11' }),
  deck('Family Matters', { setName: 'Bloomburrow', releasedAt: '2024-08-02' }),
  deck('Ahoy Mateys', { setName: 'The Lost Caverns of Ixalan', releasedAt: '2023-11-17' }),
  deck('My Brew', { isPrecon: false, ownerId: 'u1' }),
];

const names = (decks: LibraryDeck[]) => decks.map((d) => d.name);

describe('orderDecks', () => {
  it('groups by set, newest set first, with community decks on top', () => {
    const sections = orderDecks(DECKS, 'set');
    expect(sections.map((s) => s.title)).toEqual([
      'Community Decks',
      'Tarkir: Dragonstorm',
      'Bloomburrow',
      'The Lost Caverns of Ixalan',
    ]);
    expect(sections[0].setName).toBeNull();
    expect(sections[2]).toMatchObject({ setName: 'Bloomburrow', releasedAt: '2024-08-02' });
    expect(names(sections[2].decks)).toEqual(['Animated Army', 'Family Matters']);
  });

  it('sorts precons newest first, breaking ties by name', () => {
    const [community, precons] = orderDecks(DECKS, 'newest');
    expect(names(community.decks)).toEqual(['My Brew']);
    expect(names(precons.decks)).toEqual(['Abzan Armor', 'Animated Army', 'Family Matters', 'Ahoy Mateys']);
  });

  it('sorts precons oldest first', () => {
    const [, precons] = orderDecks(DECKS, 'oldest');
    expect(names(precons.decks)).toEqual(['Ahoy Mateys', 'Animated Army', 'Family Matters', 'Abzan Armor']);
  });

  it('sorts by name', () => {
    const [, precons] = orderDecks(DECKS, 'name');
    expect(names(precons.decks)).toEqual(['Abzan Armor', 'Ahoy Mateys', 'Animated Army', 'Family Matters']);
  });

  it('puts undated precons after dated ones', () => {
    const [precons] = orderDecks([deck('Undated'), deck('Dated', { releasedAt: '2024-01-01' })], 'oldest');
    expect(names(precons.decks)).toEqual(['Dated', 'Undated']);
  });

  it('leaves out empty sections', () => {
    expect(orderDecks([deck('Solo', { releasedAt: '2024-01-01' })], 'name').map((s) => s.title)).toEqual([
      'Preconstructed Decks',
    ]);
  });
});
