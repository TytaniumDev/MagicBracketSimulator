import { describe, it, expect } from 'vitest';
import { activePodChunks, aggregatePodStandings, countPods, parsePodRunJobIds, podCombinations, podRunPath, savedPodRunPath, slotCount } from './pods';
import type { JobResponse } from '@shared/types/job';

/** Seats whose deck ids are the deck names. */
function seats(names: string[]) {
  return names.map((name) => ({ deckId: name, name, link: null, colorIdentity: [] }));
}

/** Per-seat results from wins and average win turns by name. */
function results(names: string[], wins: Record<string, number>, avgWinTurn: Record<string, number>, gamesPlayed: number) {
  return { gamesPlayed, seats: names.map((n) => ({ wins: wins[n] ?? 0, avgWinTurn: avgWinTurn[n] ?? null })) };
}

function makeJob(overrides: Partial<JobResponse> = {}): JobResponse {
  return {
    id: 'job',
    name: '',
    seats: seats(['A', 'B', 'C', 'D']),
    status: 'COMPLETED',
    simulations: 8,
    gamesCompleted: 8,
    parallelism: 4,
    createdAt: '2026-10-24T00:00:00.000Z',
    durationMs: null,
    retryCount: 0,
    results: null,
    ...overrides,
  };
}

describe('podCombinations', () => {
  it('returns the single pod for exactly 4 decks', () => {
    expect(podCombinations(['a', 'b', 'c', 'd'])).toEqual([['a', 'b', 'c', 'd']]);
  });

  it('returns every unordered 4-deck pod for 6 decks', () => {
    const pods = podCombinations(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(pods).toHaveLength(15);
    const keys = new Set(pods.map((p) => [...p].sort().join('')));
    expect(keys.size).toBe(15);
    expect(pods.every((p) => p.length === 4)).toBe(true);
  });

  it('returns nothing when there are fewer decks than seats', () => {
    expect(podCombinations(['a', 'b', 'c'])).toEqual([]);
  });

  it('agrees with countPods', () => {
    for (let n = 0; n <= 10; n++) {
      const items = Array.from({ length: n }, (_, i) => i);
      expect(podCombinations(items)).toHaveLength(countPods(n));
    }
    expect(countPods(10)).toBe(210);
  });
});

describe('pod run path', () => {
  it('round-trips job ids', () => {
    const ids = ['abc', 'def', 'g h'];
    const path = podRunPath(ids);
    expect(parsePodRunJobIds(path.slice(path.indexOf('?')))).toEqual(ids);
  });

  it('ignores empty entries', () => {
    expect(parsePodRunJobIds('?jobs=a,,b,')).toEqual(['a', 'b']);
    expect(parsePodRunJobIds('')).toEqual([]);
  });

  it('links a saved run by its id', () => {
    expect(savedPodRunPath('run123')).toBe('/pods/run123');
  });
});

describe('activePodChunks', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];

  it('keeps only batches with an unfinished pod', () => {
    expect(activePodChunks(ids, new Set(['d']), 2)).toEqual([['c', 'd']]);
  });

  it('batches by position, not by which pods are unfinished', () => {
    expect(activePodChunks(ids, new Set(['a', 'e']), 2)).toEqual([['a', 'b'], ['e']]);
  });

  it('returns nothing once every pod is finished', () => {
    expect(activePodChunks(ids, new Set(), 2)).toEqual([]);
  });
});

describe('aggregatePodStandings', () => {
  it('sums wins and games across pods and sorts by win rate', () => {
    const standings = aggregatePodStandings([
      makeJob({
        seats: seats(['A', 'B', 'C', 'D']),
        results: results(['A', 'B', 'C', 'D'], { A: 4, B: 2, C: 1, D: 1 }, { A: 8, B: 10, C: 9, D: 12 }, 8),
      }),
      makeJob({
        seats: seats(['A', 'B', 'C', 'E']),
        results: results(['A', 'B', 'C', 'E'], { A: 2, B: 0, C: 2, E: 4 }, { A: 11, C: 7, E: 9 }, 8),
      }),
    ]);

    expect(standings.map((s) => s.name)).toEqual(['E', 'A', 'C', 'B', 'D']);
    const a = standings.find((s) => s.name === 'A')!;
    expect(a).toMatchObject({ pods: 2, gamesPlayed: 16, wins: 6 });
    expect(a.winRate).toBeCloseTo(6 / 16);
    // Weighted by wins: (8*4 + 11*2) / 6 = 9
    expect(a.avgWinTurn).toBeCloseTo(9);
    expect(standings.find((s) => s.name === 'B')!.avgWinTurn).toBe(10);
  });

  it('skips pods without results', () => {
    const standings = aggregatePodStandings([
      makeJob({ status: 'QUEUED', results: null }),
      makeJob({ results: results(['A', 'B', 'C', 'D'], { A: 1 }, {}, 4) }),
    ]);
    const a = standings.find((s) => s.name === 'A')!;
    expect(a.pods).toBe(1);
    expect(a.gamesPlayed).toBe(4);
    expect(a.avgWinTurn).toBeNull();
    expect(standings.find((s) => s.name === 'D')!.wins).toBe(0);
  });
});

describe('slotCount', () => {
  it('shows one pod of slots until it is full', () => {
    expect(slotCount(0)).toBe(4);
    expect(slotCount(3)).toBe(4);
  });

  it('adds a spare slot once a pod is full, up to the run limit', () => {
    expect(slotCount(4)).toBe(5);
    expect(slotCount(9)).toBe(10);
    expect(slotCount(10)).toBe(10);
  });
});
