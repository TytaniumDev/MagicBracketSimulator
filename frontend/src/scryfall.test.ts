import { describe, it, expect } from 'vitest';
import { cardKey, toScryfallCard } from './scryfall';

describe('cardKey', () => {
  it('keys split cards by their front face, case-insensitively', () => {
    expect(cardKey('Fire // Ice')).toBe('fire');
    expect(cardKey('Sol Ring')).toBe('sol ring');
  });
});

describe('toScryfallCard', () => {
  it('uses the front face image and type for double-faced cards', () => {
    const card = toScryfallCard({
      name: 'Delver of Secrets // Insectile Aberration',
      cmc: 1,
      card_faces: [
        { type_line: 'Creature — Human Wizard', mana_cost: '{U}', image_uris: { normal: 'front.jpg' } },
        { type_line: 'Creature — Human Insect', mana_cost: '', image_uris: { normal: 'back.jpg' } },
      ],
    });
    expect(card).toMatchObject({ typeLine: 'Creature — Human Wizard', manaCost: '{U}', imageUrl: 'front.jpg' });
  });

  it('shows only the main cost of adventure-style cards', () => {
    const card = toScryfallCard({
      name: 'Bloomvine Regent // Claim Territory',
      type_line: 'Creature — Dragon // Sorcery — Omen',
      mana_cost: '{3}{G}{G} // {2}{G}',
      cmc: 5,
      image_uris: { normal: 'card.jpg' },
    });
    expect(card.manaCost).toBe('{3}{G}{G}');
  });
});
