import { describe, it, expect } from 'vitest';
import { setCodeFor, type ScryfallSet } from './scryfall-sets';

const set = (code: string, name: string, setType = 'expansion'): ScryfallSet => ({ code, name, setType });

const SETS: ScryfallSet[] = [
  set('tdm', 'Tarkir: Dragonstorm'),
  set('tdc', 'Tarkir: Dragonstorm Commander', 'commander'),
  set('pip', 'Fallout', 'commander'),
  set('ltr', 'The Lord of the Rings: Tales of Middle-earth'),
  set('ltc', 'Tales of Middle-earth Commander', 'commander'),
  set('slu', 'Secret Lair: Ultimate Edition', 'box'),
  set('sld', 'Secret Lair Drop', 'box'),
];

describe('setCodeFor', () => {
  it('uses the set with exactly that name', () => {
    expect(setCodeFor('Tarkir: Dragonstorm', SETS)).toBe('TDM');
    expect(setCodeFor('fallout', SETS)).toBe('PIP');
  });

  it('matches a set whose name ends with the given name, over its Commander set', () => {
    expect(setCodeFor('Tales of Middle-earth', SETS)).toBe('LTR');
  });

  it('prefers the shortest name among loose matches of the same type', () => {
    expect(setCodeFor('Secret Lair', SETS)).toBe('SLD');
  });

  it('matches a longer product name that starts with a set name', () => {
    expect(setCodeFor('Secret Lair Drop - WUBRG EDH Precon Decklist', SETS)).toBe('SLD');
  });

  it('returns null for a missing or unknown set', () => {
    expect(setCodeFor(null, SETS)).toBeNull();
    expect(setCodeFor('Unknown Set', SETS)).toBeNull();
  });
});
