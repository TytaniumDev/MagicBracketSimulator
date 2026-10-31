import { afterEach, describe, it, expect, vi } from 'vitest';
import { cardKey, fetchScryfallCards, indexByFace, toScryfallCard, type ScryfallCard } from './scryfall';

describe('cardKey', () => {
  it('keys split cards by their front face, case-insensitively', () => {
    expect(cardKey('Fire // Ice')).toBe('fire');
    expect(cardKey('Sol Ring')).toBe('sol ring');
  });
});

describe('indexByFace', () => {
  const card = (name: string): ScryfallCard => ({ name, typeLine: '', manaCost: '', manaValue: 0, imageUrl: null, artCropUrl: null, scryfallUrl: null });

  it('finds a card by any of its face names', () => {
    const whirlwing = card('Whirlwing Stormbrood // Dynamic Soar');
    const index = indexByFace([whirlwing, card('Sol Ring')]);
    expect(index['whirlwing stormbrood']).toBe(whirlwing);
    expect(index['dynamic soar']).toBe(whirlwing);
    expect(Object.keys(index).sort()).toEqual(['dynamic soar', 'sol ring', 'whirlwing stormbrood']);
  });

  it('lets a front face win over another card\'s back face', () => {
    const front = card('Ice');
    const index = indexByFace([card('Fire // Ice'), front]);
    expect(index['ice']).toBe(front);
  });
});

describe('toScryfallCard', () => {
  it('uses the front face image and type for double-faced cards', () => {
    const card = toScryfallCard({
      name: 'Delver of Secrets // Insectile Aberration',
      cmc: 1,
      card_faces: [
        { type_line: 'Creature — Human Wizard', mana_cost: '{U}', image_uris: { normal: 'front.jpg', art_crop: 'front-art.jpg' } },
        { type_line: 'Creature — Human Insect', mana_cost: '', image_uris: { normal: 'back.jpg' } },
      ],
    });
    expect(card).toMatchObject({
      typeLine: 'Creature — Human Wizard',
      manaCost: '{U}',
      imageUrl: 'front.jpg',
      artCropUrl: 'front-art.jpg',
    });
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

describe('fetchScryfallCards', () => {
  type Identifier = Record<string, string>;
  const cardJson = (name: string, image: string) => ({ name, image_uris: { normal: image } });

  /** Stubs Scryfall: `answer` maps each identifier to a card, or null when not found. */
  function stubScryfall(answer: (id: Identifier) => ReturnType<typeof cardJson> | null) {
    const requests: Identifier[][] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const { identifiers } = JSON.parse(init.body as string) as { identifiers: Identifier[] };
      requests.push(identifiers);
      const data = identifiers.map(answer).filter((c) => c != null);
      return new Response(JSON.stringify({ data }));
    }));
    return requests;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('looks cards up by their printing when the decklist names one', async () => {
    const requests = stubScryfall((id) =>
      id.set === 'tdc' && id.collector_number === '121' ? cardJson('Indomitable Ancients', 'tdc-121.jpg') : null,
    );
    const lookup = await fetchScryfallCards([{ name: 'Indomitable Ancients', setCode: 'TDC', collectorNumber: '121' }]);
    expect(requests).toEqual([[{ set: 'tdc', collector_number: '121' }]]);
    expect(lookup['indomitable ancients'].imageUrl).toBe('tdc-121.jpg');
  });

  it('falls back to the set, then the name, when the printing is unknown', async () => {
    const requests = stubScryfall((id) => {
      if (id.name === 'Sol Ring' && id.set === 'tdc') return cardJson('Sol Ring', 'tdc-sol-ring.jpg');
      if (id.name === 'Forest' && !id.set) return cardJson('Forest', 'default-forest.jpg');
      return null;
    });
    const lookup = await fetchScryfallCards([
      { name: 'Sol Ring', setCode: 'tdc', collectorNumber: '999' },
      { name: 'Forest', setCode: 'tdc' },
    ]);
    expect(requests).toEqual([
      [{ set: 'tdc', collector_number: '999' }],
      [{ name: 'Sol Ring', set: 'tdc' }, { name: 'Forest', set: 'tdc' }],
      [{ name: 'Forest' }],
    ]);
    expect(lookup['sol ring'].imageUrl).toBe('tdc-sol-ring.jpg');
    expect(lookup['forest'].imageUrl).toBe('default-forest.jpg');
  });

  it('ignores a printing that turns out to be a different card', async () => {
    stubScryfall((id) => (id.collector_number ? cardJson('Arcane Signet', 'wrong.jpg') : cardJson('Sol Ring', 'sol-ring.jpg')));
    const lookup = await fetchScryfallCards([{ name: 'Sol Ring', setCode: 'c21', collectorNumber: '1' }]);
    expect(lookup['sol ring'].imageUrl).toBe('sol-ring.jpg');
    expect(lookup['arcane signet']).toBeUndefined();
  });

  it('looks up two-part cards by their front face and keys every face', async () => {
    const requests = stubScryfall(() => cardJson('Fire // Ice', 'fire-ice.jpg'));
    const lookup = await fetchScryfallCards([{ name: 'Fire // Ice' }]);
    expect(requests).toEqual([[{ name: 'Fire' }]]);
    expect(lookup['fire'].imageUrl).toBe('fire-ice.jpg');
    expect(lookup['ice'].imageUrl).toBe('fire-ice.jpg');
  });
});
