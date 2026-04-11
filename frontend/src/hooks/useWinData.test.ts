import { describe, it, expect } from 'vitest';
import { computeSimWins, computeStructuredWins, resolveEffectiveWins } from './useWinData';
import type { SimulationStatus } from '@shared/types/simulation';
import type { StructuredGame } from '@shared/types/log';
import type { JobResults } from '@shared/types/job';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DECK_NAMES = ['Deck A', 'Deck B', 'Deck C', 'Deck D'];

function makeSim(overrides: Partial<SimulationStatus> = {}): SimulationStatus {
  return {
    simId: 'sim_001',
    index: 0,
    state: 'COMPLETED',
    ...overrides,
  };
}

function makeGame(overrides: Partial<StructuredGame> = {}): StructuredGame {
  return {
    totalTurns: 10,
    players: DECK_NAMES,
    turns: [],
    decks: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// computeSimWins
// ---------------------------------------------------------------------------

describe('computeSimWins', () => {
  it('returns null tally when no simulations', () => {
    const result = computeSimWins([], DECK_NAMES);
    expect(result.simWinTally).toBeNull();
    expect(result.simWinTurns).toBeNull();
    expect(result.simGamesCompleted).toBe(0);
  });

  it('returns null tally when sims have no win data', () => {
    const sims = [makeSim({ winners: [] }), makeSim({ winners: [] })];
    const result = computeSimWins(sims, DECK_NAMES);
    expect(result.simWinTally).toBeNull();
    expect(result.simGamesCompleted).toBe(2); // Falls back to sim count
  });

  it('counts wins from winners[] array (multi-game containers)', () => {
    const sims = [
      makeSim({ winners: ['Deck A', 'Deck B', 'Deck A', 'Deck C'], winningTurns: [8, 12, 7, 15] }),
      makeSim({ simId: 'sim_002', index: 1, winners: ['Deck D', 'Deck A', 'Deck B', 'Deck A'], winningTurns: [10, 9, 11, 6] }),
    ];
    const result = computeSimWins(sims, DECK_NAMES);
    expect(result.simWinTally).toEqual({
      'Deck A': 4,
      'Deck B': 2,
      'Deck C': 1,
      'Deck D': 1,
    });
    expect(result.simGamesCompleted).toBe(8);
  });

  it('falls back to single winner field (legacy containers)', () => {
    const sims = [
      makeSim({ winner: 'Deck A', winningTurn: 8 }),
      makeSim({ simId: 'sim_002', index: 1, winner: 'Deck B', winningTurn: 12 }),
    ];
    const result = computeSimWins(sims, DECK_NAMES);
    expect(result.simWinTally).toEqual({
      'Deck A': 1,
      'Deck B': 1,
      'Deck C': 0,
      'Deck D': 0,
    });
    expect(result.simGamesCompleted).toBe(2);
  });

  it('resolves Ai(N)-prefixed names to deck names', () => {
    const sims = [
      makeSim({ winners: ['Ai(1)-Deck A', 'Ai(2)-Deck B', 'Ai(3)-Deck C', 'Ai(4)-Deck D'] }),
    ];
    const result = computeSimWins(sims, DECK_NAMES);
    expect(result.simWinTally).toEqual({
      'Deck A': 1,
      'Deck B': 1,
      'Deck C': 1,
      'Deck D': 1,
    });
  });

  it('sorts winning turns for each deck', () => {
    const sims = [
      makeSim({ winners: ['Deck A', 'Deck A', 'Deck A'], winningTurns: [15, 7, 10] }),
    ];
    const result = computeSimWins(sims, DECK_NAMES);
    expect(result.simWinTurns!['Deck A']).toEqual([7, 10, 15]);
  });

  it('ignores non-COMPLETED simulations', () => {
    const sims = [
      makeSim({ state: 'RUNNING', winner: 'Deck A' }),
      makeSim({ simId: 'sim_002', state: 'FAILED', winner: 'Deck B' }),
      makeSim({ simId: 'sim_003', state: 'COMPLETED', winner: 'Deck C', winningTurn: 8 }),
    ];
    const result = computeSimWins(sims, DECK_NAMES);
    expect(result.simWinTally).toEqual({
      'Deck A': 0,
      'Deck B': 0,
      'Deck C': 1,
      'Deck D': 0,
    });
    expect(result.simGamesCompleted).toBe(1);
  });

  it('handles mixed container types (winners[] + single winner)', () => {
    const sims = [
      makeSim({ winners: ['Deck A', 'Deck B'], winningTurns: [8, 12] }),
      makeSim({ simId: 'sim_002', index: 1, winner: 'Deck C', winningTurn: 10 }),
    ];
    const result = computeSimWins(sims, DECK_NAMES);
    expect(result.simWinTally).toEqual({
      'Deck A': 1,
      'Deck B': 1,
      'Deck C': 1,
      'Deck D': 0,
    });
    // gamesCompleted: 2 (sim_001 winners[].length) + 1 (sim_002 single-game fallback) = 3
    expect(result.simGamesCompleted).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// computeStructuredWins
// ---------------------------------------------------------------------------

describe('computeStructuredWins', () => {
  it('returns null when no structured games', () => {
    expect(computeStructuredWins(null, DECK_NAMES).structuredWinTally).toBeNull();
    expect(computeStructuredWins([], DECK_NAMES).structuredWinTally).toBeNull();
  });

  it('counts wins from structured games', () => {
    const games = [
      makeGame({ winner: 'Deck A', winningTurn: 8 }),
      makeGame({ winner: 'Deck B', winningTurn: 12 }),
      makeGame({ winner: 'Deck A', winningTurn: 7 }),
    ];
    const result = computeStructuredWins(games, DECK_NAMES);
    expect(result.structuredWinTally).toEqual({
      'Deck A': 2,
      'Deck B': 1,
      'Deck C': 0,
      'Deck D': 0,
    });
    expect(result.structuredWinTurns!['Deck A']).toEqual([7, 8]);
  });

  it('resolves Ai(N)-prefixed winners', () => {
    const games = [makeGame({ winner: 'Ai(1)-Deck A', winningTurn: 8 })];
    const result = computeStructuredWins(games, DECK_NAMES);
    expect(result.structuredWinTally!['Deck A']).toBe(1);
  });

  it('handles games with no winner', () => {
    const games = [makeGame({ winner: undefined })];
    const result = computeStructuredWins(games, DECK_NAMES);
    expect(result.structuredWinTally).toEqual({
      'Deck A': 0,
      'Deck B': 0,
      'Deck C': 0,
      'Deck D': 0,
    });
  });
});

// ---------------------------------------------------------------------------
// resolveEffectiveWins (three-way fallback chain)
// ---------------------------------------------------------------------------

describe('resolveEffectiveWins', () => {
  const noSims: ReturnType<typeof computeSimWins> = {
    simWinTally: null,
    simWinTurns: null,
    simGamesCompleted: 0,
  };
  const noStructured: ReturnType<typeof computeStructuredWins> = {
    structuredWinTally: null,
    structuredWinTurns: null,
  };

  it('prefers server results when present', () => {
    const serverResults: JobResults = {
      wins: { 'Deck A': 5, 'Deck B': 3 },
      avgWinTurn: { 'Deck A': 8, 'Deck B': 12 },
      gamesPlayed: 8,
    };
    const simResult = computeSimWins(
      [makeSim({ winners: ['Deck C'] })],
      DECK_NAMES,
    );
    const result = resolveEffectiveWins(serverResults, simResult, noStructured, null);
    expect(result.winTally).toEqual({ 'Deck A': 5, 'Deck B': 3 });
    expect(result.gamesPlayed).toBe(8);
  });

  it('falls back to structured games when no server results', () => {
    const games = [
      makeGame({ winner: 'Deck A', winningTurn: 8 }),
      makeGame({ winner: 'Deck B', winningTurn: 12 }),
    ];
    const structResult = computeStructuredWins(games, DECK_NAMES);
    const result = resolveEffectiveWins(null, noSims, structResult, games);
    expect(result.winTally).toEqual({
      'Deck A': 1,
      'Deck B': 1,
      'Deck C': 0,
      'Deck D': 0,
    });
    expect(result.gamesPlayed).toBe(2);
  });

  it('falls back to simulation statuses when no server results and no structured games', () => {
    const sims = [
      makeSim({ winner: 'Deck A', winningTurn: 8 }),
      makeSim({ simId: 'sim_002', index: 1, winner: 'Deck B', winningTurn: 12 }),
    ];
    const simResult = computeSimWins(sims, DECK_NAMES);
    const result = resolveEffectiveWins(null, simResult, noStructured, null);
    expect(result.winTally).toEqual({
      'Deck A': 1,
      'Deck B': 1,
      'Deck C': 0,
      'Deck D': 0,
    });
    expect(result.gamesPlayed).toBe(2);
  });

  it('returns null tally when all sources empty', () => {
    const result = resolveEffectiveWins(null, noSims, noStructured, null);
    expect(result.winTally).toBeNull();
    expect(result.winTurns).toBeNull();
    expect(result.gamesPlayed).toBe(0);
  });

  it('prefers structured game turns over sim turns', () => {
    const games = [makeGame({ winner: 'Deck A', winningTurn: 8 })];
    const structResult = computeStructuredWins(games, DECK_NAMES);
    const simResult = computeSimWins(
      [makeSim({ winner: 'Deck A', winningTurn: 15 })],
      DECK_NAMES,
    );
    const result = resolveEffectiveWins(null, simResult, structResult, games);
    // Structured wins should be preferred since they're available
    expect(result.winTurns!['Deck A']).toEqual([8]);
  });
});
