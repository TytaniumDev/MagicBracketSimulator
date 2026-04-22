import { strict as assert } from 'node:assert';
import { emptyWinTurnAggregate, addWinTurn, type WinTurnAggregate } from './win-turn-aggregate';

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

console.log('win-turn-aggregate');

test('emptyWinTurnAggregate returns zeroed 16-bin aggregate', () => {
  const agg = emptyWinTurnAggregate();
  assert.equal(agg.winTurnSum, 0);
  assert.equal(agg.winTurnWins, 0);
  assert.equal(agg.winTurnHistogram.length, 16);
  assert.ok(agg.winTurnHistogram.every((n) => n === 0));
});

test('addWinTurn(8) increments bin index 7 and sum/count', () => {
  const agg = addWinTurn(emptyWinTurnAggregate(), 8);
  assert.equal(agg.winTurnSum, 8);
  assert.equal(agg.winTurnWins, 1);
  assert.equal(agg.winTurnHistogram[7], 1);
  assert.equal(agg.winTurnHistogram[6], 0);
});

test('addWinTurn(1) increments bin 0', () => {
  const agg = addWinTurn(emptyWinTurnAggregate(), 1);
  assert.equal(agg.winTurnHistogram[0], 1);
  assert.equal(agg.winTurnSum, 1);
});

test('addWinTurn(0) clamps up to bin 0', () => {
  const agg = addWinTurn(emptyWinTurnAggregate(), 0);
  assert.equal(agg.winTurnHistogram[0], 1);
  assert.equal(agg.winTurnSum, 0);
});

test('addWinTurn(16) falls into bin 15 (16+)', () => {
  const agg = addWinTurn(emptyWinTurnAggregate(), 16);
  assert.equal(agg.winTurnHistogram[15], 1);
  assert.equal(agg.winTurnSum, 16);
});

test('addWinTurn(42) falls into bin 15 with raw sum', () => {
  const agg = addWinTurn(emptyWinTurnAggregate(), 42);
  assert.equal(agg.winTurnHistogram[15], 1);
  assert.equal(agg.winTurnSum, 42);
  assert.equal(agg.winTurnWins, 1);
});

test('addWinTurn does not mutate input aggregate', () => {
  const original = emptyWinTurnAggregate();
  const next = addWinTurn(original, 5);
  assert.equal(original.winTurnHistogram[4], 0);
  assert.equal(next.winTurnHistogram[4], 1);
  assert.notEqual(original, next);
});

test('addWinTurn accumulates across multiple calls', () => {
  let agg: WinTurnAggregate = emptyWinTurnAggregate();
  agg = addWinTurn(agg, 4);
  agg = addWinTurn(agg, 8);
  agg = addWinTurn(agg, 20);
  assert.equal(agg.winTurnSum, 32);
  assert.equal(agg.winTurnWins, 3);
  assert.equal(agg.winTurnHistogram[3], 1);
  assert.equal(agg.winTurnHistogram[7], 1);
  assert.equal(agg.winTurnHistogram[15], 1);
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
