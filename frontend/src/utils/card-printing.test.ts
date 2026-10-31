import { describe, it, expect } from 'vitest';
import { cardLookups, deckDefaultSet } from './card-printing';

describe('deckDefaultSet', () => {
  const commanders = [{ quantity: 1, name: 'Felothar the Steadfast', setCode: 'tdc', collectorNumber: '1' }];

  it("is a precon's commander set", () => {
    expect(deckDefaultSet(true, commanders)).toBe('tdc');
  });

  it('is unset for custom decks and commanders without a printing', () => {
    expect(deckDefaultSet(false, commanders)).toBeUndefined();
    expect(deckDefaultSet(true, [{ quantity: 1, name: 'Felothar the Steadfast' }])).toBeUndefined();
  });
});

describe('cardLookups', () => {
  it("keeps a card's own printing and gives the rest the default set", () => {
    expect(
      cardLookups(
        [
          { quantity: 1, name: 'Sol Ring', setCode: 'c21', collectorNumber: '263' },
          { quantity: 10, name: 'Forest' },
        ],
        'tdc',
      ),
    ).toEqual([
      { name: 'Sol Ring', setCode: 'c21', collectorNumber: '263' },
      { name: 'Forest', setCode: 'tdc' },
    ]);
  });
});
