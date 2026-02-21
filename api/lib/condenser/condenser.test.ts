/**
 * Tests for the log condenser pipeline using a real 4-game simulation log.
 *
 * Run with: npx tsx lib/condenser/condenser.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { condenseGame, condenseGames } from './index';
import { extractWinner, extractWinningTurn, getNumPlayers, extractTurnRanges, calculatePerDeckTurns } from './turns';
import { splitConcatenatedGames } from './patterns';
import { matchesDeckName } from './deck-match';

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
          (name) => matchesDeckName(game.winner!, name)
        );
        if (found) winCounts[found]++;
      }
    }

    assertEqual(winCounts['Explorers of the Deep'], 1, 'Explorers wins');
    assertEqual(winCounts['Doran Big Butts'], 1, 'Doran wins');
    assertEqual(winCounts['Enduring Enchantments'], 2, 'Enduring wins');
  });

  // =========================================================================
  // Regression: getNumPlayers returns 4 for Commander
  // =========================================================================

  await test('getNumPlayers: returns 4 for a 4-player Commander game', () => {
    const games = splitConcatenatedGames(rawLog);
    for (let i = 0; i < games.length; i++) {
      const ranges = extractTurnRanges(games[i]);
      const numPlayers = getNumPlayers(ranges);
      assertEqual(numPlayers, 4, `Game ${i + 1} should have 4 players`);
    }
  });

  // =========================================================================
  // Regression: extractWinningTurn returns personal turn counts, not raw segments
  // =========================================================================

  await test('extractWinningTurn: returns personal turn counts <= 20, not raw segments', () => {
    const games = splitConcatenatedGames(rawLog);
    for (let i = 0; i < games.length; i++) {
      const turn = extractWinningTurn(games[i]);
      assert(turn !== undefined, `Game ${i + 1} should have a winning turn`);
      assert(turn! <= 20, `Game ${i + 1} winning turn should be <= 20 (personal turn count), got ${turn}`);
    }
  });

  // =========================================================================
  // Regression: extractWinner does NOT contain "Game outcome:" prefix
  // =========================================================================

  await test('extractWinner: does not contain "Game outcome:" prefix', () => {
    const games = splitConcatenatedGames(rawLog);
    for (let i = 0; i < games.length; i++) {
      const winner = extractWinner(games[i]);
      assert(winner !== undefined, `Game ${i + 1} should have a winner`);
      assert(
        !winner!.toLowerCase().includes('game outcome'),
        `Game ${i + 1} winner should not contain "Game outcome:" prefix, got "${winner}"`
      );
    }
  });

  // =========================================================================
  // Per-deck turn counting (calculatePerDeckTurns)
  // =========================================================================

  // Expected per-deck turn counts from manual inspection of the fixture:
  // | Game | Doran | Enduring | Explorers | Veloci | Winner (turns) |
  // |------|-------|----------|-----------|--------|----------------|
  // | 1    | 10    | 8        | 11        | 10     | Explorers (11) |
  // | 2    | 11    | 10       | 8         | 9      | Doran (11)     |
  // | 3    | 15    | 16       | 12        | 14     | Enduring (16)  |
  // | 4    | 8     | 9        | 8         | 7      | Enduring (9)   |

  const expectedPerDeckTurns = [
    { 'Doran Big Butts': 10, 'Enduring Enchantments': 8, 'Explorers of the Deep': 11, 'Veloci-RAMP-Tor': 10 },
    { 'Doran Big Butts': 11, 'Enduring Enchantments': 10, 'Explorers of the Deep': 8, 'Veloci-RAMP-Tor': 9 },
    { 'Doran Big Butts': 15, 'Enduring Enchantments': 16, 'Explorers of the Deep': 12, 'Veloci-RAMP-Tor': 14 },
    { 'Doran Big Butts': 8, 'Enduring Enchantments': 9, 'Explorers of the Deep': 8, 'Veloci-RAMP-Tor': 7 },
  ];

  const expectedWinnerTurns = [11, 11, 16, 9];

  await test('calculatePerDeckTurns: Game 1 exact per-deck turn counts', () => {
    const games = splitConcatenatedGames(rawLog);
    const ranges = extractTurnRanges(games[0]);
    const perDeck = calculatePerDeckTurns(ranges);
    for (const [deckName, expected] of Object.entries(expectedPerDeckTurns[0])) {
      const key = Object.keys(perDeck).find((k) => matchesDeckName(k, deckName));
      assert(key !== undefined, `Should find key for ${deckName}`);
      assertEqual(perDeck[key!].turnsTaken, expected, `Game 1 ${deckName} turns`);
    }
  });

  await test('calculatePerDeckTurns: Game 2 exact per-deck turn counts', () => {
    const games = splitConcatenatedGames(rawLog);
    const ranges = extractTurnRanges(games[1]);
    const perDeck = calculatePerDeckTurns(ranges);
    for (const [deckName, expected] of Object.entries(expectedPerDeckTurns[1])) {
      const key = Object.keys(perDeck).find((k) => matchesDeckName(k, deckName));
      assert(key !== undefined, `Should find key for ${deckName}`);
      assertEqual(perDeck[key!].turnsTaken, expected, `Game 2 ${deckName} turns`);
    }
  });

  await test('calculatePerDeckTurns: Game 3 exact per-deck turn counts', () => {
    const games = splitConcatenatedGames(rawLog);
    const ranges = extractTurnRanges(games[2]);
    const perDeck = calculatePerDeckTurns(ranges);
    for (const [deckName, expected] of Object.entries(expectedPerDeckTurns[2])) {
      const key = Object.keys(perDeck).find((k) => matchesDeckName(k, deckName));
      assert(key !== undefined, `Should find key for ${deckName}`);
      assertEqual(perDeck[key!].turnsTaken, expected, `Game 3 ${deckName} turns`);
    }
  });

  await test('calculatePerDeckTurns: Game 4 exact per-deck turn counts', () => {
    const games = splitConcatenatedGames(rawLog);
    const ranges = extractTurnRanges(games[3]);
    const perDeck = calculatePerDeckTurns(ranges);
    for (const [deckName, expected] of Object.entries(expectedPerDeckTurns[3])) {
      const key = Object.keys(perDeck).find((k) => matchesDeckName(k, deckName));
      assert(key !== undefined, `Should find key for ${deckName}`);
      assertEqual(perDeck[key!].turnsTaken, expected, `Game 4 ${deckName} turns`);
    }
  });

  await test('calculatePerDeckTurns: each game has 4 decks', () => {
    const games = splitConcatenatedGames(rawLog);
    for (let i = 0; i < games.length; i++) {
      const ranges = extractTurnRanges(games[i]);
      const perDeck = calculatePerDeckTurns(ranges);
      assertEqual(Object.keys(perDeck).length, 4, `Game ${i + 1} deck count in perDeckTurns`);
    }
  });

  await test('condenseGame: turnCount equals winner personal turn count', () => {
    const games = splitConcatenatedGames(rawLog);
    for (let i = 0; i < games.length; i++) {
      const condensed = condenseGame(games[i]);
      assertEqual(condensed.turnCount, expectedWinnerTurns[i], `Game ${i + 1} turnCount should be winner's personal turn count`);
    }
  });

  await test('condenseGame: winningTurn equals turnCount for all 4 games', () => {
    const games = splitConcatenatedGames(rawLog);
    for (let i = 0; i < games.length; i++) {
      const condensed = condenseGame(games[i]);
      assertEqual(condensed.winningTurn, condensed.turnCount, `Game ${i + 1} winningTurn should equal turnCount`);
    }
  });

  await test('condenseGame: perDeckTurns is populated with 4 decks per game', () => {
    const games = splitConcatenatedGames(rawLog);
    for (let i = 0; i < games.length; i++) {
      const condensed = condenseGame(games[i]);
      assert(condensed.perDeckTurns !== undefined, `Game ${i + 1} should have perDeckTurns`);
      assertEqual(Object.keys(condensed.perDeckTurns!).length, 4, `Game ${i + 1} perDeckTurns deck count`);
    }
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
