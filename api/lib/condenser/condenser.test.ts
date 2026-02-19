/**
 * Tests for the log condenser pipeline using a real 4-game simulation log.
 *
 * Run with: npx tsx lib/condenser/condenser.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { condenseGame, condenseGames } from './index';
import { extractWinner, extractWinningTurn } from './turns';
import { splitConcatenatedGames } from './patterns';

// ---------------------------------------------------------------------------
// Test Utilities (same pattern as game-logs.test.ts)
// ---------------------------------------------------------------------------

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
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
// Load fixture
// ---------------------------------------------------------------------------

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'real-4game-log.txt');

function loadFixture(): string {
  return fs.readFileSync(FIXTURE_PATH, 'utf-8');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function runTests() {
  console.log('Running condenser tests...\n');

  const rawLog = loadFixture();

  // =========================================================================
  // splitConcatenatedGames
  // =========================================================================

  await test('splitConcatenatedGames: splits 4-game log into 4 individual games', () => {
    const games = splitConcatenatedGames(rawLog);
    assertEqual(games.length, 4, 'game count');
  });

  await test('splitConcatenatedGames: each game has a valid winner', () => {
    const games = splitConcatenatedGames(rawLog);
    for (let i = 0; i < games.length; i++) {
      const winner = extractWinner(games[i]);
      assert(winner !== undefined && winner.length > 0, `Game ${i + 1} should have a winner, got "${winner}"`);
    }
  });

  await test('splitConcatenatedGames: single game without markers returns as-is', () => {
    const singleGame = 'Turn: Turn 1 (Ai(0)-TestDeck)\nSome action\n';
    const games = splitConcatenatedGames(singleGame);
    assertEqual(games.length, 1, 'single game count');
    assert(games[0].includes('Turn: Turn 1'), 'should contain original content');
  });

  await test('splitConcatenatedGames: empty input returns empty array', () => {
    const games = splitConcatenatedGames('');
    assertEqual(games.length, 0, 'empty input should return empty array');
  });

  await test('splitConcatenatedGames: whitespace-only input returns empty array', () => {
    const games = splitConcatenatedGames('   \n  \n  ');
    assertEqual(games.length, 0, 'whitespace input should return empty array');
  });

  // =========================================================================
  // extractWinner
  // =========================================================================

  await test('extractWinner: correct winner from game 1', () => {
    const games = splitConcatenatedGames(rawLog);
    const winner = extractWinner(games[0]);
    assert(winner !== undefined, 'game 1 should have a winner');
    assert(winner!.includes('Explorers of the Deep'), `Expected Explorers of the Deep, got "${winner}"`);
  });

  await test('extractWinner: correct winner from game 2', () => {
    const games = splitConcatenatedGames(rawLog);
    const winner = extractWinner(games[1]);
    assert(winner !== undefined, 'game 2 should have a winner');
    assert(winner!.includes('Doran Big Butts'), `Expected Doran Big Butts, got "${winner}"`);
  });

  await test('extractWinner: correct winners across all 4 games', () => {
    const games = splitConcatenatedGames(rawLog);
    const winners = games.map(g => extractWinner(g));
    assert(winners[0]!.includes('Explorers of the Deep'), `Game 1 winner: ${winners[0]}`);
    assert(winners[1]!.includes('Doran Big Butts'), `Game 2 winner: ${winners[1]}`);
    assert(winners[2]!.includes('Enduring Enchantments'), `Game 3 winner: ${winners[2]}`);
    assert(winners[3]!.includes('Enduring Enchantments'), `Game 4 winner: ${winners[3]}`);
  });

  await test('extractWinner: returns undefined for log with no winner', () => {
    const noWinner = 'Turn: Turn 1 (Ai(0)-TestDeck)\nSome action\nTurn: Turn 2 (Ai(1)-OtherDeck)\n';
    const winner = extractWinner(noWinner);
    assertEqual(winner, undefined, 'no-winner log');
  });

  // =========================================================================
  // extractWinningTurn
  // =========================================================================

  await test('extractWinningTurn: returns a positive round number from real game', () => {
    const games = splitConcatenatedGames(rawLog);
    for (let i = 0; i < games.length; i++) {
      const turn = extractWinningTurn(games[i]);
      assert(turn !== undefined && turn > 0, `Game ${i + 1} winning turn should be > 0, got ${turn}`);
    }
  });

  await test('extractWinningTurn: returns undefined for log with no turns', () => {
    const noTurns = 'Some random log content with no turn markers\n';
    const turn = extractWinningTurn(noTurns);
    assertEqual(turn, undefined, 'no-turns log should return undefined');
  });

  // =========================================================================
  // condenseGame
  // =========================================================================

  await test('condenseGame: produces valid condensed output from a real game', () => {
    const games = splitConcatenatedGames(rawLog);
    const condensed = condenseGame(games[0]);

    assert(condensed.turnCount > 0, `turnCount should be > 0, got ${condensed.turnCount}`);
    assert(condensed.keptEvents.length > 0, 'should have kept events');
    assert(condensed.winner !== undefined, 'should have a winner');
    assert(condensed.winningTurn !== undefined && condensed.winningTurn > 0, 'should have a winning turn');
  });

  await test('condenseGame: keptEvents contain expected event types', () => {
    const games = splitConcatenatedGames(rawLog);
    const condensed = condenseGame(games[0]);
    const types = new Set(condensed.keptEvents.map(e => e.type));

    // A real Commander game should have spells, lands, combat, and life changes
    assert(types.has('spell_cast') || types.has('spell_cast_high_cmc'), 'should have spell events');
    assert(types.has('land_played'), 'should have land_played events');
    assert(types.has('combat'), 'should have combat events');
    assert(types.has('life_change'), 'should have life_change events');
  });

  await test('condenseGame: manaPerTurn has entries', () => {
    const games = splitConcatenatedGames(rawLog);
    const condensed = condenseGame(games[0]);
    const turns = Object.keys(condensed.manaPerTurn);
    assert(turns.length > 0, 'manaPerTurn should have entries');
  });

  // =========================================================================
  // condenseGames (batch)
  // =========================================================================

  await test('condenseGames: processes all 4 games', () => {
    const games = splitConcatenatedGames(rawLog);
    const condensed = condenseGames(games);
    assertEqual(condensed.length, 4, 'should condense all 4 games');
    for (let i = 0; i < condensed.length; i++) {
      assert(condensed[i].turnCount > 0, `Game ${i + 1} should have turns`);
    }
  });

  await test('condenseGames: win counts across 4 games match expected', () => {
    const games = splitConcatenatedGames(rawLog);
    const condensed = condenseGames(games);

    // From the fixture: Explorers=1, Doran=1, Enduring=2
    // Winners are in "Game outcome: Ai(N)-DeckName" format - use endsWith matching
    const deckNames = ['Explorers of the Deep', 'Doran Big Butts', 'Enduring Enchantments'];
    const winCounts: Record<string, number> = {};
    for (const name of deckNames) winCounts[name] = 0;

    for (const game of condensed) {
      if (game.winner) {
        const found = deckNames.find(
          (name) => game.winner === name || game.winner?.endsWith(`-${name}`)
        );
        if (found) winCounts[found]++;
      }
    }

    assertEqual(winCounts['Explorers of the Deep'], 1, 'Explorers wins');
    assertEqual(winCounts['Doran Big Butts'], 1, 'Doran wins');
    assertEqual(winCounts['Enduring Enchantments'], 2, 'Enduring wins');
  });

  // =========================================================================
  // Summary
  // =========================================================================

  console.log('\n--- Test Summary ---');
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`Passed: ${passed}/${results.length}`);
  console.log(`Failed: ${failed}/${results.length}`);

  if (failed > 0) {
    console.log('\nFailed tests:');
    results
      .filter((r) => !r.passed)
      .forEach((r) => {
        console.log(`  - ${r.name}: ${r.error}`);
      });
    process.exit(1);
  }

  console.log('\nAll tests passed!');
}

runTests().catch((error) => {
  console.error('Test runner error:', error);
  process.exit(1);
});
