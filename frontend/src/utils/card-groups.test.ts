import { describe, it, expect } from 'vitest';
import { groupDeckCards, primaryType } from './card-groups';
import type { ScryfallCard } from '../scryfall';

function info(name: string, typeLine: string, manaValue = 0): ScryfallCard {
  return { name, typeLine, manaCost: '', manaValue, imageUrl: null, artCropUrl: null, scryfallUrl: null };
}

const LOOKUP: Record<string, ScryfallCard> = {
  'sol ring': info('Sol Ring', 'Artifact', 1),
  'steel hellkite': info('Steel Hellkite', 'Artifact Creature — Construct', 6),
  'llanowar elves': info('Llanowar Elves', 'Creature — Elf Druid', 1),
  forest: info('Forest', 'Basic Land — Forest'),
  'dryad arbor': info('Dryad Arbor', 'Land Creature — Forest Dryad'),
  fire: info('Fire // Ice', 'Instant // Instant', 4),
  'delver of secrets': info('Delver of Secrets // Insectile Aberration', 'Creature — Human Wizard // Creature — Human Insect', 1),
};

describe('primaryType', () => {
  it('treats artifact creatures as creatures', () => {
    expect(primaryType('Artifact Creature — Construct')).toBe('Creature');
  });

  it('treats land creatures as lands', () => {
    expect(primaryType('Land Creature — Forest Dryad')).toBe('Land');
  });

  it('uses only the front face of a double-faced card', () => {
    expect(primaryType('Sorcery // Land')).toBe('Sorcery');
  });

  it('returns null for unknown types', () => {
    expect(primaryType('Conspiracy')).toBeNull();
  });
});

describe('groupDeckCards', () => {
  const cards = [
    { quantity: 1, name: 'Steel Hellkite' },
    { quantity: 10, name: 'Forest' },
    { quantity: 1, name: 'Sol Ring' },
    { quantity: 1, name: 'Llanowar Elves' },
    { quantity: 1, name: 'Dryad Arbor' },
    { quantity: 1, name: 'Fire // Ice' },
    { quantity: 1, name: 'Unknown Card' },
  ];

  it('groups by type in display order, with unknowns last', () => {
    const groups = groupDeckCards(cards, LOOKUP);
    expect(groups.map((g) => g.label)).toEqual(['Creatures', 'Instants', 'Artifacts', 'Lands', 'Other']);
  });

  it('sorts each group by mana value, then name', () => {
    const creatures = groupDeckCards(cards, LOOKUP).find((g) => g.label === 'Creatures')!;
    expect(creatures.cards.map((c) => c.name)).toEqual(['Llanowar Elves', 'Steel Hellkite']);
  });

  it('counts copies, not lines', () => {
    const lands = groupDeckCards(cards, LOOKUP).find((g) => g.label === 'Lands')!;
    expect(lands.count).toBe(11);
  });

  it('matches double-faced cards by their front face', () => {
    const groups = groupDeckCards([{ quantity: 1, name: 'Delver of Secrets' }], LOOKUP);
    expect(groups[0].label).toBe('Creatures');
  });

  it('puts everything in Other while card data is loading', () => {
    const groups = groupDeckCards(cards, undefined);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('Other');
    expect(groups[0].count).toBe(16);
  });
});
