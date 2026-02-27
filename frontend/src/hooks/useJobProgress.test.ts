import { describe, it, expect } from 'vitest';
import { parseRtdbSimulations } from './useJobProgress';

// ---------------------------------------------------------------------------
// parseRtdbSimulations
// ---------------------------------------------------------------------------

describe('parseRtdbSimulations', () => {
  it('adds index from simId when RTDB data lacks it', () => {
    const rtdbSims = {
      sim_002: { state: 'RUNNING', workerId: 'w1' },
      sim_000: { state: 'COMPLETED', workerId: 'w1' },
      sim_001: { state: 'PENDING' },
    };

    const result = parseRtdbSimulations(rtdbSims);

    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ simId: 'sim_000', index: 0 });
    expect(result[1]).toMatchObject({ simId: 'sim_001', index: 1 });
    expect(result[2]).toMatchObject({ simId: 'sim_002', index: 2 });
  });

  it('preserves index when RTDB data includes it', () => {
    const rtdbSims = {
      sim_003: { state: 'RUNNING', index: 3, workerId: 'w1' },
      sim_001: { state: 'COMPLETED', index: 1, workerId: 'w1' },
    };

    const result = parseRtdbSimulations(rtdbSims);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ simId: 'sim_001', index: 1 });
    expect(result[1]).toMatchObject({ simId: 'sim_003', index: 3 });
  });

  it('sorts by index', () => {
    const rtdbSims = {
      sim_005: { state: 'PENDING', index: 5 },
      sim_002: { state: 'RUNNING', index: 2 },
      sim_000: { state: 'COMPLETED', index: 0 },
    };

    const result = parseRtdbSimulations(rtdbSims);

    expect(result.map(s => s.index)).toEqual([0, 2, 5]);
    expect(result.map(s => s.simId)).toEqual(['sim_000', 'sim_002', 'sim_005']);
  });

  it('filters out simulations with unparseable simId and no index', () => {
    const rtdbSims = {
      sim_000: { state: 'COMPLETED' },
      'bad-id': { state: 'RUNNING' },        // no numeric suffix, no index
      '': { state: 'PENDING' },               // empty key, no index
      sim_002: { state: 'PENDING' },
    };

    const result = parseRtdbSimulations(rtdbSims);

    expect(result).toHaveLength(2);
    expect(result.map(s => s.simId)).toEqual(['sim_000', 'sim_002']);
  });

  it('keeps entries with explicit index even if simId is unparseable', () => {
    const rtdbSims = {
      'custom-id': { state: 'RUNNING', index: 7 },
    };

    const result = parseRtdbSimulations(rtdbSims);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ simId: 'custom-id', index: 7 });
  });

  it('returns empty array for empty input', () => {
    expect(parseRtdbSimulations({})).toEqual([]);
  });

  it('prefers RTDB index over parsed simId index', () => {
    // Edge case: RTDB has index=10 but simId is sim_005
    const rtdbSims = {
      sim_005: { state: 'RUNNING', index: 10 },
    };

    const result = parseRtdbSimulations(rtdbSims);

    expect(result[0].index).toBe(10);
  });
});
