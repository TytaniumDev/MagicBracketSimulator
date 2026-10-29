import { describe, it, expect } from 'vitest';
import type { CardImpact } from '@shared/types/card-impact';
import { formatLift, isPermanent, MIN_CASTS_TO_RANK, topSwingCards } from './card-impact';

function card(name: string, overrides: Partial<CardImpact> = {}): CardImpact {
  return {
    name,
    cast: MIN_CASTS_TO_RANK,
    castRate: 0.5,
    avgCastTurn: 5,
    winRateWhenCast: 0.3,
    winLift: 0,
    closeLift: 0,
    avgDamageToPlayers: 0,
    leftBattlefieldRate: 0,
    targetedRate: 0,
    ...overrides,
  };
}

describe('topSwingCards', () => {
  const notLand = () => false;

  it('ranks by close lift, then win lift', () => {
    const ranked = topSwingCards(
      [
        card('Steady', { closeLift: 0.1, winLift: 0.05 }),
        card('Bomb', { closeLift: 0.4 }),
        card('Tied', { closeLift: 0.1, winLift: 0.2 }),
      ],
      notLand,
    );
    expect(ranked.map((c) => c.name)).toEqual(['Bomb', 'Tied', 'Steady']);
  });

  it('leaves out rarely cast cards and lands', () => {
    const ranked = topSwingCards(
      [card('Rare', { cast: MIN_CASTS_TO_RANK - 1, closeLift: 0.9 }), card('Forest', { closeLift: 0.5 }), card('Kept')],
      (name) => name === 'Forest',
    );
    expect(ranked.map((c) => c.name)).toEqual(['Kept']);
  });

  it('caps the list', () => {
    const many = Array.from({ length: 15 }, (_, i) => card(`Card ${i}`, { closeLift: i / 100 }));
    expect(topSwingCards(many, notLand, 10)).toHaveLength(10);
  });
});

describe('isPermanent', () => {
  it('recognizes permanents by front face', () => {
    expect(isPermanent('Legendary Creature — Dragon')).toBe(true);
    expect(isPermanent('Instant')).toBe(false);
    expect(isPermanent('Sorcery // Land')).toBe(false);
  });
});

describe('formatLift', () => {
  it('shows signed percentage points', () => {
    expect(formatLift(0.184)).toBe('+18 pts');
    expect(formatLift(-0.05)).toBe('-5 pts');
    expect(formatLift(0)).toBe('0 pts');
  });
});
