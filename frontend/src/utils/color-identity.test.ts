import { describe, it, expect } from 'vitest';
import { deckColors } from './color-identity';

describe('deckColors', () => {
  it('orders colors WUBRG', () => {
    expect(deckColors(['G', 'W', 'B'])).toEqual(['W', 'B', 'G']);
  });

  it('treats an empty or missing identity as colorless', () => {
    expect(deckColors([])).toEqual(['C']);
    expect(deckColors(undefined)).toEqual(['C']);
  });
});
