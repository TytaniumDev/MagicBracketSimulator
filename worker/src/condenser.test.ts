/**
 * Unit tests for worker/src/condenser.ts.
 *
 * Covers the matchesDeckName logic that MUST stay in sync with
 * api/lib/condenser/deck-match.ts. If this test file drifts from
 * api/lib/condenser/deck-match.test.ts, the two implementations have
 * diverged and the worker will report incorrect winners.
 *
 * Cross-implementation agreement (winner & winning-turn) is enforced
 * by api/test/condenser-contract.test.ts which imports both condensers
 * directly. This file covers only the worker's own unit surface.
 *
 * Run with: npx tsx src/condenser.test.ts
 */

import {
  extractWinner,
  extractWinningTurn,
  splitConcatenatedGames,
} from './condenser.js';

// ---------------------------------------------------------------------------
// Minimal test harness (mirrors override.test.ts style)
// ---------------------------------------------------------------------------

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
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}

// ---------------------------------------------------------------------------
// extractWinner
// ---------------------------------------------------------------------------

console.log('Running condenser tests...\n');

test('extractWinner: empty log returns empty string', () => {
  assertEqual(extractWinner(''), '', 'empty');
});

test('extractWinner: recognises "X wins the game"', () => {
  assertEqual(
    extractWinner('Turn 5: Alice\nAlice wins the game\n'),
    'Alice',
    '"wins the game"'
  );
});

test('extractWinner: recognises "X has won!"', () => {
  assertEqual(
    extractWinner('Ai(1)-Blood Rites has won!\n'),
    'Ai(1)-Blood Rites',
    '"has won!"'
  );
});

test('extractWinner: handles Ai-prefixed full deck name', () => {
  const log = 'Ai(2)-Blood Rites - The Lost Caverns of Ixalan Commander has won!\n';
  const winner = extractWinner(log);
  // The raw winner from extractWinner is the Forge log string
  assert(winner.includes('Blood Rites'), 'should contain Blood Rites');
});

// ---------------------------------------------------------------------------
// extractWinningTurn
// ---------------------------------------------------------------------------

test('extractWinningTurn: empty log returns 0', () => {
  assertEqual(extractWinningTurn(''), 0, 'empty returns 0');
});

test('extractWinningTurn: 4-player game, winner took 3 turns', () => {
  const log = [
    'Turn: Turn 1 (Alice)', 'stuff',
    'Turn: Turn 2 (Bob)', 'stuff',
    'Turn: Turn 3 (Carol)', 'stuff',
    'Turn: Turn 4 (Dan)', 'stuff',
    'Turn: Turn 5 (Alice)', 'stuff',
    'Turn: Turn 6 (Bob)', 'stuff',
    'Turn: Turn 7 (Carol)', 'stuff',
    'Turn: Turn 8 (Dan)', 'stuff',
    'Turn: Turn 9 (Alice)', 'stuff',
    'Turn: Turn 10 (Bob)', 'stuff',
    'Turn: Turn 11 (Carol)', 'stuff',
    'Carol has won because all opponents have lost',
  ].join('\n');
  assertEqual(extractWinningTurn(log), 3, 'Carol took 3 turns (turns 3, 7, 11)');
});

test('extractWinningTurn: falls back to max-per-deck when winner unknown', () => {
  const log = [
    'Turn: Turn 1 (Alice)', 'stuff',
    'Turn: Turn 2 (Bob)', 'stuff',
    'Turn: Turn 3 (Carol)', 'stuff',
    'Turn: Turn 4 (Dan)', 'stuff',
    'Turn: Turn 5 (Alice)', 'stuff',
    'Turn: Turn 6 (Bob)', 'stuff',
    'Turn: Turn 7 (Carol)', 'stuff',
    'Turn: Turn 8 (Dan)', 'stuff',
    'Turn: Turn 9 (Bob)', 'stuff',
    'Eve has won because all opponents have lost', // Eve not in turns
  ].join('\n');
  // Falls through to max-per-deck = Bob (3 turns)
  assertEqual(extractWinningTurn(log), 3, 'max-per-deck fallback');
});

test('extractWinningTurn: old format (bare "Turn N:") returns 0 (no player attribution)', () => {
  const log = [
    'Turn 1:', 'stuff',
    'Turn 2:', 'stuff',
    'Turn 3:', 'stuff',
    'Turn 4:', 'stuff',
    'Turn 5:', 'Alice has won because all opponents have lost',
  ].join('\n');
  // Bare "Turn N:" with nothing after the colon doesn't match either turn
  // marker regex (both require a player name). extractWinningTurn returns 0.
  assertEqual(extractWinningTurn(log), 0, 'bare Turn N: with no player returns 0');
});

// ---------------------------------------------------------------------------
// splitConcatenatedGames
// ---------------------------------------------------------------------------

test('splitConcatenatedGames: single game with no Game Result marker', () => {
  const log = 'Turn 1:\nTurn 2:\nAlice wins the game\n';
  const games = splitConcatenatedGames(log);
  assertEqual(games.length, 1, 'one game');
});

test('splitConcatenatedGames: two games split by Game Result line', () => {
  const log = [
    'Turn 1: stuff',
    'Alice wins the game',
    'Game Result: Game 1 ended',
    'Turn 1: stuff',
    'Bob wins the game',
    'Game Result: Game 2 ended',
  ].join('\n');
  const games = splitConcatenatedGames(log);
  assertEqual(games.length, 2, 'two games');
});

test('splitConcatenatedGames: empty string returns one empty entry', () => {
  const games = splitConcatenatedGames('');
  // Implementation returns [''] (one empty game) for empty input
  assertEqual(games.length, 1, 'single entry');
});

// ---------------------------------------------------------------------------
// matchesDeckName parity cases (same as api/lib/condenser/deck-match.test.ts)
// These are tested indirectly via extractWinner + extractWinningTurn above
// but we also test directly here for regression coverage.
// ---------------------------------------------------------------------------

// The function is not exported from condenser.ts, so we test it through
// extractWinningTurn which uses it internally to look up the winner's turns.

test('matchesDeckName parity: precon with set suffix resolves winning turn', () => {
  const log = [
    'Turn: Turn 1 (Ai(1)-Doran Big Butts)', 'stuff',
    'Turn: Turn 2 (Ai(2)-Blood Rites - The Lost Caverns of Ixalan Commander)', 'stuff',
    'Turn: Turn 3 (Ai(3)-Counter Blitz - Final Fantasy Commander)', 'stuff',
    'Turn: Turn 4 (Ai(4)-World Shaper - Edge of Eternities Commander Deck)', 'stuff',
    'Turn: Turn 5 (Ai(1)-Doran Big Butts)', 'stuff',
    'Turn: Turn 6 (Ai(2)-Blood Rites - The Lost Caverns of Ixalan Commander)', 'stuff',
    'Ai(2)-Blood Rites - The Lost Caverns of Ixalan Commander has won!',
  ].join('\n');
  // Blood Rites took turns 2 and 6 → 2 turns
  assertEqual(extractWinningTurn(log), 2, 'precon set suffix matches winner turns');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('\n-------------------');
const passed = results.filter((r) => r.passed).length;
const failed = results.filter((r) => !r.passed).length;
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failed > 0) process.exit(1);
