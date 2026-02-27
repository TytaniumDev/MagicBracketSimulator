/**
 * Tests for the structured game building pipeline.
 *
 * Covers: buildStructuredGame(), attributeLines(), filterStructuredToSignificant(),
 * and the batch structureGames() wrapper.
 *
 * Run with: npx tsx lib/condenser/structured.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { buildStructuredGame, attributeLines, filterStructuredToSignificant } from './structured';
import { structureGames } from './index';
import { splitConcatenatedGames } from './patterns';
import { extractWinner, calculateLifePerTurn } from './turns';

// ---------------------------------------------------------------------------
// Test Utilities (same pattern as condenser.test.ts)
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
  console.log('Running structured game tests...\n');

  const rawLog = loadFixture();
  const games = splitConcatenatedGames(rawLog);

  // =========================================================================
  // buildStructuredGame
  // =========================================================================

  await test('buildStructuredGame: produces 4 decks for a 4-player game', () => {
    const result = buildStructuredGame(games[0]);
    assertEqual(result.decks.length, 4, 'deck count');
  });

  await test('buildStructuredGame: totalTurns is a valid personal turn count', () => {
    const result = buildStructuredGame(games[0]);
    assert(result.totalTurns > 0, `totalTurns should be > 0, got ${result.totalTurns}`);
    assert(result.totalTurns <= 20, `totalTurns should be <= 20 (personal turn count), got ${result.totalTurns}`);
  });

  await test('buildStructuredGame: each deck has turn entries', () => {
    const result = buildStructuredGame(games[0]);
    for (let i = 0; i < result.decks.length; i++) {
      assert(
        result.decks[i].turns.length > 0,
        `Deck ${i} ("${result.decks[i].deckLabel}") should have turns, got ${result.decks[i].turns.length}`
      );
    }
  });

  await test('buildStructuredGame: turn numbers are sequential rounds starting at 1', () => {
    const result = buildStructuredGame(games[0]);
    for (const deck of result.decks) {
      const turnNumbers = deck.turns.map((t) => t.turnNumber);
      assertEqual(turnNumbers[0], 1, `${deck.deckLabel} first turn`);
      for (let i = 1; i < turnNumbers.length; i++) {
        assert(
          turnNumbers[i] > turnNumbers[i - 1],
          `${deck.deckLabel} turns should be ascending: ${turnNumbers[i - 1]} -> ${turnNumbers[i]}`
        );
      }
    }
  });

  await test('buildStructuredGame: winner matches extractWinner output', () => {
    const result = buildStructuredGame(games[0]);
    const expectedWinner = extractWinner(games[0]);
    assertEqual(result.winner, expectedWinner, 'winner consistency');
  });

  await test('buildStructuredGame: winningTurn is a valid personal turn count', () => {
    const result = buildStructuredGame(games[0]);
    assert(result.winningTurn !== undefined, 'should have a winningTurn');
    assert(result.winningTurn! > 0, `winningTurn should be > 0, got ${result.winningTurn}`);
    assert(result.winningTurn! <= 20, `winningTurn should be <= 20, got ${result.winningTurn}`);
  });

  await test('buildStructuredGame: players array has 4 player identifiers', () => {
    const result = buildStructuredGame(games[0]);
    assertEqual(result.players.length, 4, 'players count');
  });

  // =========================================================================
  // attributeLines
  // =========================================================================

  await test('attributeLines: all lines attributed to a known player', () => {
    const lines = attributeLines(games[0]);
    assert(lines.length > 0, 'should have attributed lines');
    const unknownLines = lines.filter((l) => l.player === 'Unknown');
    assertEqual(unknownLines.length, 0, 'unknown player count');
  });

  await test('attributeLines: returns turn 0 / Unknown for markerless log', () => {
    const markerless = 'Some action happened.\nAnother event occurred.\n';
    const lines = attributeLines(markerless);
    assert(lines.length > 0, 'should have lines');
    for (const line of lines) {
      assertEqual(line.turnNumber, 0, 'turn number for markerless');
      assertEqual(line.player, 'Unknown', 'player for markerless');
    }
  });

  // =========================================================================
  // buildStructuredGame with deckNames
  // =========================================================================

  await test('buildStructuredGame: with deckNames, labels match provided names', () => {
    const deckNames = ['Explorers of the Deep', 'Doran Big Butts', 'Enduring Enchantments', 'Graveyard Shift'];
    const result = buildStructuredGame(games[0], deckNames);
    for (let i = 0; i < deckNames.length; i++) {
      assertEqual(result.decks[i].deckLabel, deckNames[i], `deck ${i} label`);
    }
  });

  await test('buildStructuredGame: Ai(N)-DeckName keys resolve to clean names', () => {
    const deckNames = ['Explorers of the Deep', 'Doran Big Butts', 'Enduring Enchantments', 'Graveyard Shift'];
    const result = buildStructuredGame(games[0], deckNames);
    // The first deckNames.length decks should have clean labels (no Ai() prefix)
    for (let i = 0; i < deckNames.length; i++) {
      assert(
        !result.decks[i].deckLabel.startsWith('Ai('),
        `Deck ${i} label should not have Ai() prefix, got "${result.decks[i].deckLabel}"`
      );
      assertEqual(result.decks[i].deckLabel, deckNames[i], `deck ${i} label`);
    }
    // Decks matched by endsWith should have actual turn data (playerKey resolved correctly)
    // At least 3 of 4 decks should have turns (the 4th name "Graveyard Shift" may not be in the fixture)
    const decksWithTurns = result.decks.slice(0, deckNames.length).filter((d) => d.turns.length > 0);
    assert(decksWithTurns.length >= 3, `At least 3 decks should have turns via endsWith matching, got ${decksWithTurns.length}`);
  });

  // =========================================================================
  // Event classification
  // =========================================================================

  await test('buildStructuredGame: actions have eventType when classifiable', () => {
    const result = buildStructuredGame(games[0]);
    let classifiedCount = 0;
    for (const deck of result.decks) {
      for (const turn of deck.turns) {
        for (const action of turn.actions) {
          if (action.eventType) classifiedCount++;
        }
      }
    }
    assert(classifiedCount > 0, `should have some classified actions, got ${classifiedCount}`);
  });

  // =========================================================================
  // Life tracking
  // =========================================================================

  await test('buildStructuredGame: lifePerTurn is empty for old-format logs (no [LIFE] entries)', () => {
    const result = buildStructuredGame(games[0]);
    assert(result.lifePerTurn !== undefined, 'should have lifePerTurn field');
    const rounds = Object.keys(result.lifePerTurn!);
    // The fixture was generated with Forge 2.0.10 (pre-[LIFE] logs), so no life data
    assertEqual(rounds.length, 0, 'should have no life data for old-format logs');
  });

  // =========================================================================
  // filterStructuredToSignificant
  // =========================================================================

  await test('filterStructuredToSignificant: removes unclassified actions', () => {
    const full = buildStructuredGame(games[0]);
    const filtered = filterStructuredToSignificant(full);

    // Count total actions in each
    let fullActionCount = 0;
    let filteredActionCount = 0;
    for (const deck of full.decks) {
      for (const turn of deck.turns) {
        fullActionCount += turn.actions.length;
      }
    }
    for (const deck of filtered.decks) {
      for (const turn of deck.turns) {
        filteredActionCount += turn.actions.length;
      }
    }

    assert(filteredActionCount < fullActionCount, `filtered (${filteredActionCount}) should be less than full (${fullActionCount})`);

    // All remaining actions should have eventType
    for (const deck of filtered.decks) {
      for (const turn of deck.turns) {
        for (const action of turn.actions) {
          assert(action.eventType !== undefined, `filtered action should have eventType: "${action.line}"`);
        }
      }
    }
  });

  // =========================================================================
  // structureGames (batch wrapper)
  // =========================================================================

  await test('structureGames: processes all 4 games from fixture', () => {
    const structured = structureGames(games);
    assertEqual(structured.length, 4, 'should structure all 4 games');
    for (let i = 0; i < structured.length; i++) {
      assert(structured[i].totalTurns > 0, `Game ${i + 1} should have turns`);
      assertEqual(structured[i].decks.length, 4, `Game ${i + 1} should have 4 decks`);
    }
  });

  // =========================================================================
  // calculateLifePerTurn - unit tests with [LIFE] log format
  // =========================================================================
  //
  // Forge (post-2.0.10) outputs explicit life changes as:
  //   [LIFE] Life: PlayerName oldValue -> newValue
  //
  // This gives us absolute life totals directly from the game engine.
  // =========================================================================

  const P1 = 'Ai(1)-DeckAlpha';
  const P2 = 'Ai(2)-DeckBeta';
  const MINI_PLAYERS = [P1, P2];

  function miniLog(turnLines: string): string {
    return `Turn: Turn 1 (${P1})\n${turnLines}\nTurn: Turn 2 (${P2})\nSome action.\n`;
  }

  await test('calculateLifePerTurn: [LIFE] entry decreases life', () => {
    const log = miniLog(`[LIFE] Life: ${P1} 40 -> 36`);
    const life = calculateLifePerTurn(log, MINI_PLAYERS, 2);
    assertEqual(life[1][P1], 36, 'P1 should be at 36');
    assertEqual(life[1][P2], 40, 'P2 should be untouched at 40');
  });

  await test('calculateLifePerTurn: [LIFE] entry increases life', () => {
    const log = miniLog(`[LIFE] Life: ${P2} 40 -> 45`);
    const life = calculateLifePerTurn(log, MINI_PLAYERS, 2);
    assertEqual(life[1][P1], 40, 'P1 untouched');
    assertEqual(life[1][P2], 45, 'P2 should gain life to 45');
  });

  await test('calculateLifePerTurn: multiple [LIFE] entries in same turn', () => {
    const log = miniLog(
      `[LIFE] Life: ${P1} 40 -> 37\n[LIFE] Life: ${P1} 37 -> 34`
    );
    const life = calculateLifePerTurn(log, MINI_PLAYERS, 2);
    assertEqual(life[1][P1], 34, 'P1 should be at 34 after two decreases');
  });

  await test('calculateLifePerTurn: player reaches 0 life', () => {
    const log = miniLog(`[LIFE] Life: ${P2} 3 -> 0`);
    const life = calculateLifePerTurn(log, MINI_PLAYERS, 2);
    assertEqual(life[1][P2], 0, 'P2 should be at 0');
  });

  await test('calculateLifePerTurn: negative life total', () => {
    const log = miniLog(`[LIFE] Life: ${P1} 2 -> -3`);
    const life = calculateLifePerTurn(log, MINI_PLAYERS, 2);
    assertEqual(life[1][P1], -3, 'P1 should be at -3');
  });

  await test('calculateLifePerTurn: no [LIFE] entries returns empty object', () => {
    const log = miniLog('Some action that does not change life.');
    const life = calculateLifePerTurn(log, MINI_PLAYERS, 2);
    assertEqual(Object.keys(life).length, 0, 'should return empty object when no [LIFE] entries');
  });

  await test('calculateLifePerTurn: both players change in same round', () => {
    const log = miniLog(
      `[LIFE] Life: ${P1} 40 -> 38\n[LIFE] Life: ${P2} 40 -> 35`
    );
    const life = calculateLifePerTurn(log, MINI_PLAYERS, 2);
    assertEqual(life[1][P1], 38, 'P1 should be at 38');
    assertEqual(life[1][P2], 35, 'P2 should be at 35');
  });

  await test('calculateLifePerTurn: life changes across multiple rounds', () => {
    // 4-player game to test round grouping
    const P3 = 'Ai(3)-DeckGamma';
    const P4 = 'Ai(4)-DeckDelta';
    const fourPlayers = [P1, P2, P3, P4];

    const log = [
      `Turn: Turn 1 (${P1})`,
      `[LIFE] Life: ${P1} 40 -> 39`,
      `Turn: Turn 2 (${P2})`,
      `[LIFE] Life: ${P2} 40 -> 37`,
      `Turn: Turn 3 (${P3})`,
      `Some action.`,
      `Turn: Turn 4 (${P4})`,
      `[LIFE] Life: ${P4} 40 -> 35`,
      // Round 2
      `Turn: Turn 5 (${P1})`,
      `[LIFE] Life: ${P1} 39 -> 30`,
      `Turn: Turn 6 (${P2})`,
      `[LIFE] Life: ${P2} 37 -> 32`,
      `Turn: Turn 7 (${P3})`,
      `[LIFE] Life: ${P3} 40 -> 28`,
      `Turn: Turn 8 (${P4})`,
      `[LIFE] Life: ${P4} 35 -> 0`,
    ].join('\n');

    const life = calculateLifePerTurn(log, fourPlayers, 4);

    // Round 1 snapshot
    assertEqual(life[1][P1], 39, 'P1 round 1');
    assertEqual(life[1][P2], 37, 'P2 round 1');
    assertEqual(life[1][P3], 40, 'P3 round 1 (unchanged)');
    assertEqual(life[1][P4], 35, 'P4 round 1');

    // Round 2 snapshot
    assertEqual(life[2][P1], 30, 'P1 round 2');
    assertEqual(life[2][P2], 32, 'P2 round 2');
    assertEqual(life[2][P3], 28, 'P3 round 2');
    assertEqual(life[2][P4], 0, 'P4 round 2 (dead)');
  });

  await test('calculateLifePerTurn: unrecognized player in [LIFE] entry is ignored', () => {
    const log = miniLog(`[LIFE] Life: Ai(9)-UnknownDeck 40 -> 35`);
    const life = calculateLifePerTurn(log, MINI_PLAYERS, 2);
    assertEqual(life[1][P1], 40, 'P1 should be untouched');
    assertEqual(life[1][P2], 40, 'P2 should be untouched');
  });

  // =========================================================================
  // calculateLifePerTurn - integration with real fixture
  // =========================================================================
  // Note: The real fixture was generated with Forge 2.0.10 (pre-[LIFE] logs).
  // Without [LIFE] entries, calculateLifePerTurn returns empty {}.
  // These tests verify the function handles old-format logs gracefully.

  await test('calculateLifePerTurn (fixture): old-format logs return empty life data', () => {
    for (let i = 0; i < games.length; i++) {
      const result = buildStructuredGame(games[i]);
      assert(result.lifePerTurn !== undefined, `game ${i + 1} should have lifePerTurn field`);
      const rounds = Object.keys(result.lifePerTurn!);
      assertEqual(rounds.length, 0, `game ${i + 1} should have empty life data (no [LIFE] entries)`);
    }
  });

  // =========================================================================
  // buildStructuredGame - integration with [LIFE] log data
  // =========================================================================
  // Tests the full pipeline: raw log with [LIFE] entries → buildStructuredGame
  // → lifePerTurn populated correctly.

  await test('buildStructuredGame: full pipeline with [LIFE] entries populates lifePerTurn', () => {
    const PA = 'Ai(1)-Alpha Deck';
    const PB = 'Ai(2)-Beta Deck';
    const PC = 'Ai(3)-Gamma Deck';
    const PD = 'Ai(4)-Delta Deck';

    // Synthetic 4-player game log with [LIFE] entries
    const syntheticLog = [
      `Turn: Turn 1 (${PA})`,
      `Land: ${PA} played Forest (41)`,
      `[LIFE] Life: ${PA} 40 -> 39`,
      `Turn: Turn 2 (${PB})`,
      `Land: ${PB} played Island (42)`,
      `[LIFE] Life: ${PB} 40 -> 38`,
      `Turn: Turn 3 (${PC})`,
      `Land: ${PC} played Mountain (43)`,
      `Turn: Turn 4 (${PD})`,
      `Land: ${PD} played Swamp (44)`,
      `[LIFE] Life: ${PD} 40 -> 35`,
      // Round 2
      `Turn: Turn 5 (${PA})`,
      `[LIFE] Life: ${PA} 39 -> 30`,
      `Turn: Turn 6 (${PB})`,
      `[LIFE] Life: ${PB} 38 -> 25`,
      `Turn: Turn 7 (${PC})`,
      `[LIFE] Life: ${PC} 40 -> 20`,
      `Turn: Turn 8 (${PD})`,
      `[LIFE] Life: ${PD} 35 -> 0`,
      `${PD} loses the game.`,
      `${PA} wins the game.`,
      `Game Result: Game 1 ended in 12345 ms. ${PA} has won!`,
    ].join('\n');

    const result = buildStructuredGame(syntheticLog);

    // Verify basic structure
    assertEqual(result.players.length, 4, 'should have 4 players');
    assertEqual(result.decks.length, 4, 'should have 4 decks');
    assert(result.winner !== undefined, 'should have a winner');

    // Verify lifePerTurn is populated
    assert(result.lifePerTurn !== undefined, 'should have lifePerTurn');
    const rounds = Object.keys(result.lifePerTurn!);
    assert(rounds.length > 0, 'should have life data for at least one round');

    // Verify round 1 life totals
    const round1 = result.lifePerTurn![1];
    assert(round1 !== undefined, 'round 1 should exist');
    assertEqual(round1[PA], 39, 'PA round 1');
    assertEqual(round1[PB], 38, 'PB round 1');
    assertEqual(round1[PC], 40, 'PC round 1 (no change)');
    assertEqual(round1[PD], 35, 'PD round 1');

    // Verify round 2 life totals
    const round2 = result.lifePerTurn![2];
    assert(round2 !== undefined, 'round 2 should exist');
    assertEqual(round2[PA], 30, 'PA round 2');
    assertEqual(round2[PB], 25, 'PB round 2');
    assertEqual(round2[PC], 20, 'PC round 2');
    assertEqual(round2[PD], 0, 'PD round 2 (dead)');
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
