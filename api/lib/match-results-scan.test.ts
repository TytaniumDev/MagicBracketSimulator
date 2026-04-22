import { strict as assert } from 'node:assert';
import { aggregateMatchResultsByWinner } from './match-results-scan';
import type { MatchResult } from './types';

function mr(id: string, winner: string | null, turnCount: number | null): MatchResult {
  return {
    id,
    jobId: id.split('_')[0] ?? id,
    gameIndex: 0,
    deckIds: ['w', 'a', 'b', 'c'],
    winnerDeckId: winner,
    turnCount,
    playedAt: '2026-04-22T00:00:00Z',
  };
}

let failures = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.error(`  ✗ ${name}\n    ${(err as Error).message}`);
  }
}

console.log('aggregateMatchResultsByWinner');

test('groups by winnerDeckId and bins turnCount correctly', () => {
  const agg = aggregateMatchResultsByWinner([
    mr('j1_0', 'deck-A', 4),
    mr('j1_1', 'deck-A', 8),
    mr('j1_2', 'deck-B', 16),
    mr('j1_3', 'deck-A', 20),
  ]);
  const a = agg.get('deck-A')!;
  assert.equal(a.winTurnSum, 32);
  assert.equal(a.winTurnWins, 3);
  assert.deepEqual(a.winTurnHistogram, [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1]);
  const b = agg.get('deck-B')!;
  assert.equal(b.winTurnWins, 1);
  assert.equal(b.winTurnHistogram[15], 1);
});

test('skips results with null winnerDeckId or null turnCount', () => {
  const agg = aggregateMatchResultsByWinner([
    mr('j1_0', null, 7),
    mr('j1_1', 'deck-A', null),
    mr('j1_2', 'deck-A', 5),
  ]);
  const a = agg.get('deck-A')!;
  assert.equal(a.winTurnWins, 1);
  assert.equal(a.winTurnSum, 5);
});

test('returns empty map for empty input', () => {
  const agg = aggregateMatchResultsByWinner([]);
  assert.equal(agg.size, 0);
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
