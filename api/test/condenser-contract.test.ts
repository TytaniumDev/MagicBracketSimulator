/**
 * Contract test: worker condenser vs API condenser.
 *
 * DATA_FLOW.md calls the worker's condenser "lightweight parsing" — it
 * runs inside the worker immediately after a container exits to build
 * a quick status update (winners[], winningTurns[]). The API re-runs
 * the full authoritative condense/structure pipeline later during
 * aggregation, and its results are what leaderboards and rating math
 * consume.
 *
 * What MUST agree between the two implementations:
 *   1. splitConcatenatedGames must produce the same NUMBER of games on
 *      both sides. If it doesn't, the status update's winners[] array
 *      has a different length than the API's aggregation expects,
 *      breaking per-game attribution.
 *   2. extractWinner must produce the same WINNER for each game index.
 *      If it doesn't, the worker reports one player as the winner and
 *      the API re-aggregates with a different one, and the UI flickers
 *      or the rating math is wrong.
 *
 * What does NOT need to agree (intentional divergence):
 *   - Byte-for-byte game boundaries. Both implementations agree on the
 *     game count and on the line containing the winner, but they may
 *     include slightly different surrounding noise in each chunk.
 *   - extractWinningTurn. The worker's turn count is a preliminary
 *     preview; the API's aggregation uses per-deck turn tracking which
 *     is authoritative and overwrites it.
 *
 * If a future change makes the worker's turn extraction authoritative,
 * add the stricter assertion here so drift is caught at test time.
 *
 * Run with: npx tsx test/condenser-contract.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  splitConcatenatedGames as apiSplit,
  extractWinner as apiExtractWinner,
  extractWinningTurn as apiExtractWinningTurn,
} from '../lib/condenser/index';
import {
  splitConcatenatedGames as workerSplit,
  extractWinner as workerExtractWinner,
  extractWinningTurn as workerExtractWinningTurn,
} from '../../worker/src/condenser';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    results.push({ name, passed: true });
    console.log(`✓ ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({ name, passed: false, error: message });
    console.log(`✗ ${name}`);
    console.log(`  Error: ${message}`);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const FIXTURE_PATH = path.join(__dirname, '..', 'lib', 'condenser', 'fixtures', 'real-4game-log.txt');
const RAW_LOG = fs.readFileSync(FIXTURE_PATH, 'utf-8');

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * The worker condenser returns `string` (empty for no winner) while the API
 * condenser returns `string | undefined`. Normalize both to `undefined` so
 * the contract check is an apples-to-apples comparison.
 */
function normWinner(w: string | undefined): string | undefined {
  if (w === undefined || w === '' || w === null) return undefined;
  return w;
}

/** Same normalization for winning turns: 0 or undefined means "no winner". */
function normTurn(t: number | undefined): number | undefined {
  if (t === undefined || t === 0) return undefined;
  return t;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('splitConcatenatedGames: both implementations produce the same game count', () => {
  const apiGames = apiSplit(RAW_LOG);
  const workerGames = workerSplit(RAW_LOG);
  assertEqual(workerGames.length, apiGames.length, 'game count');
  assert(apiGames.length > 0, 'fixture must contain at least one game');
});

test('extractWinner: worker and API agree for every split game', () => {
  // Each implementation extracts the winner from its own split output;
  // that's the real flow — the worker reports winners[] to the API and
  // the API re-derives winners during aggregation. Both sides must
  // independently arrive at the same winner per game index.
  const apiGames = apiSplit(RAW_LOG);
  const workerGames = workerSplit(RAW_LOG);
  for (let i = 0; i < apiGames.length; i++) {
    const apiW = normWinner(apiExtractWinner(apiGames[i]));
    const workerW = normWinner(workerExtractWinner(workerGames[i]));
    assertEqual(workerW, apiW, `game ${i} winner`);
  }
});

test('extractWinner: both sides find at least one winner in the fixture', () => {
  // Guardrail: the fixture log is a 4-game real match; if a parser
  // refactor accidentally produces "no winner" for every game, the
  // previous test could pass trivially (undefined === undefined).
  const apiGames = apiSplit(RAW_LOG);
  const found = apiGames.filter((g) => normWinner(apiExtractWinner(g))).length;
  assert(found > 0, 'fixture must contain at least one extractable winner');
});

test('extractWinner: empty log returns no winner on both sides', () => {
  const apiW = normWinner(apiExtractWinner(''));
  const workerW = normWinner(workerExtractWinner(''));
  assertEqual(apiW, undefined, 'api empty');
  assertEqual(workerW, undefined, 'worker empty');
});

test('extractWinningTurn: empty log returns no turn on both sides', () => {
  const apiT = normTurn(apiExtractWinningTurn(''));
  const workerT = normTurn(workerExtractWinningTurn(''));
  assertEqual(apiT, undefined, 'api empty');
  assertEqual(workerT, undefined, 'worker empty');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('\n--- Condenser Contract Test Summary ---');
const passed = results.filter((r) => r.passed).length;
const failed = results.filter((r) => !r.passed).length;
console.log(`Passed: ${passed}/${results.length}`);
console.log(`Failed: ${failed}/${results.length}`);

if (failed > 0) {
  console.log('\nFailed tests:');
  results.filter((r) => !r.passed).forEach((r) => {
    console.log(`  - ${r.name}: ${r.error}`);
  });
  process.exit(1);
}
