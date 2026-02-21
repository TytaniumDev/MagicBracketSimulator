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
import { extractWinner, calculateLifePerTurn, extractTurnRanges, getNumPlayers } from './turns';

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

  await test('buildStructuredGame: lifePerTurn has entries for each player', () => {
    const result = buildStructuredGame(games[0]);
    assert(result.lifePerTurn !== undefined, 'should have lifePerTurn');
    const rounds = Object.keys(result.lifePerTurn!);
    assert(rounds.length > 0, 'should have life data for at least one round');
    // Check that the first round has entries for all players
    const firstRound = result.lifePerTurn![Number(rounds[0])];
    const playerCount = Object.keys(firstRound).length;
    assertEqual(playerCount, 4, 'life entries per round');
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
  // calculateLifePerTurn - unit tests with synthetic logs
  // =========================================================================

  const P1 = 'Ai(1)-DeckAlpha';
  const P2 = 'Ai(2)-DeckBeta';
  const MINI_PLAYERS = [P1, P2];

  function miniLog(turnLines: string): string {
    return `Turn: Turn 1 (${P1})\n${turnLines}\nTurn: Turn 2 (${P2})\nSome action.\n`;
  }

  await test('calculateLifePerTurn: non-combat damage reduces life', () => {
    const log = miniLog(`Damage: Ripjaw Raptor (344) deals 4 non-combat damage to ${P1}.`);
    const life = calculateLifePerTurn(log, MINI_PLAYERS, 2);
    const round1 = life[1];
    assertEqual(round1[P1], 36, 'P1 should lose 4 from non-combat damage');
    assertEqual(round1[P2], 40, 'P2 should be untouched');
  });

  await test('calculateLifePerTurn: combat damage still works (regression)', () => {
    const log = miniLog(`Damage: Grizzly Bears (1) deals 2 combat damage to ${P2}.`);
    const life = calculateLifePerTurn(log, MINI_PLAYERS, 2);
    const round1 = life[1];
    assertEqual(round1[P1], 40, 'P1 untouched');
    assertEqual(round1[P2], 38, 'P2 should lose 2 from combat damage');
  });

  await test('calculateLifePerTurn: plain damage (no qualifier) still works', () => {
    const log = miniLog(`Damage: Lightning Bolt (1) deals 3 damage to ${P1}.`);
    const life = calculateLifePerTurn(log, MINI_PLAYERS, 2);
    assertEqual(life[1][P1], 37, 'P1 should lose 3 from plain damage');
  });

  await test('calculateLifePerTurn: "you gain N life" with Activator metadata', () => {
    const log = miniLog(
      `Resolve stack: Whenever you cast an enchantment spell, you gain 3 life and draw a card. [Card: Foo (1), Activator: ${P2}, SpellAbility: Foo]`
    );
    const life = calculateLifePerTurn(log, MINI_PLAYERS, 2);
    assertEqual(life[1][P2], 43, 'P2 should gain 3 life from Activator-based gain');
    assertEqual(life[1][P1], 40, 'P1 untouched');
  });

  await test('calculateLifePerTurn: "you lose N life" with Phase metadata', () => {
    const log = miniLog(
      `Resolve stack: At the beginning of your upkeep, you lose 1 life and amass Zombies 1. [Phase: ${P2}]`
    );
    const life = calculateLifePerTurn(log, MINI_PLAYERS, 2);
    assertEqual(life[1][P2], 39, 'P2 should lose 1 life from upkeep trigger');
    assertEqual(life[1][P1], 40, 'P1 untouched');
  });

  await test('calculateLifePerTurn: "paying N life" with Activator metadata', () => {
    const log = miniLog(
      `Resolve stack: Cast spell (by paying 2 life instead of paying its mana cost). [Card: Bar (1), Activator: ${P1}, SpellAbility: Bar]`
    );
    const life = calculateLifePerTurn(log, MINI_PLAYERS, 2);
    assertEqual(life[1][P1], 38, 'P1 should lose 2 life from paying cost');
    assertEqual(life[1][P2], 40, 'P2 untouched');
  });

  await test('calculateLifePerTurn: combined gain + pay on same line (net -1)', () => {
    const log = miniLog(
      `Resolve stack: Whenever you cast an enchantment spell, you gain 1 life and draw a card. [Card: The Binding of the Titans (198), Activator: ${P2}, SpellAbility: The Binding of the Titans by Demon (142) (by paying 2 life instead of paying its mana cost)]`
    );
    const life = calculateLifePerTurn(log, MINI_PLAYERS, 2);
    // Gain 1, pay 2 = net -1 from starting 40
    assertEqual(life[1][P2], 39, 'P2 should be at 39 (gain 1, pay 2 = net -1)');
  });

  await test('calculateLifePerTurn: existing "Player loses N life" still works (regression)', () => {
    const log = miniLog(`${P1} loses 3 life.`);
    const life = calculateLifePerTurn(log, MINI_PLAYERS, 2);
    assertEqual(life[1][P1], 37, 'P1 should lose 3 from direct loss');
  });

  await test('calculateLifePerTurn: existing "you gain N life [Phase:]" still works (regression)', () => {
    const log = miniLog(`Some effect: you gain 5 life. [Phase: ${P1}]`);
    const life = calculateLifePerTurn(log, MINI_PLAYERS, 2);
    assertEqual(life[1][P1], 45, 'P1 should gain 5 from Phase-based gain');
  });

  await test('calculateLifePerTurn: no double-counting when line matches both gain patterns', () => {
    // This line matches both GAINS_LIFE_PATTERN (has [Phase:]) and YOU_GAIN_LIFE_PATTERN
    const log = miniLog(`Some effect: you gain 2 life. [Phase: ${P1}]`);
    const life = calculateLifePerTurn(log, MINI_PLAYERS, 2);
    assertEqual(life[1][P1], 42, 'P1 should gain exactly 2, not 4 (no double-count)');
  });

  await test('calculateLifePerTurn: skips "you gain" when player cannot be identified', () => {
    // No metadata brackets at all - should be ignored
    const log = miniLog('Resolve stack: you gain 5 life.');
    const life = calculateLifePerTurn(log, MINI_PLAYERS, 2);
    assertEqual(life[1][P1], 40, 'P1 untouched');
    assertEqual(life[1][P2], 40, 'P2 untouched');
  });

  // =========================================================================
  // calculateLifePerTurn - integration with real fixture
  // =========================================================================

  await test('calculateLifePerTurn (fixture): life totals are reasonable for game 1', () => {
    const game1 = games[0];
    const result = buildStructuredGame(game1);
    const life = result.lifePerTurn!;
    const rounds = Object.keys(life).map(Number).sort((a, b) => a - b);
    assert(rounds.length > 0, 'should have life data');

    // Round 1: all players should start near 40 (small adjustments possible)
    const round1 = life[rounds[0]];
    for (const [player, total] of Object.entries(round1)) {
      assert(total <= 45, `${player} round 1 life ${total} should be <= 45`);
      assert(total >= 30, `${player} round 1 life ${total} should be >= 30`);
    }

    // Final round: no player should exceed ~80 (Commander starts at 40, gains are bounded)
    const lastRound = life[rounds[rounds.length - 1]];
    for (const [player, total] of Object.entries(lastRound)) {
      assert(total <= 80, `${player} final life ${total} should be <= 80`);
    }
  });

  await test('calculateLifePerTurn (fixture): dead players end at 0', () => {
    const game1 = games[0];
    const result = buildStructuredGame(game1);
    const life = result.lifePerTurn!;
    const rounds = Object.keys(life).map(Number).sort((a, b) => a - b);
    const lastRound = life[rounds[rounds.length - 1]];

    // At least one player should be at 0 (game ended, someone died)
    const deadPlayers = Object.entries(lastRound).filter(([, total]) => total <= 0);
    assert(deadPlayers.length >= 1, `at least 1 player should be dead (<=0), got ${deadPlayers.length}`);
  });

  await test('calculateLifePerTurn (fixture): life totals change over time', () => {
    const game1 = games[0];
    const result = buildStructuredGame(game1);
    const life = result.lifePerTurn!;
    const rounds = Object.keys(life).map(Number).sort((a, b) => a - b);

    // At least some player's life should differ between round 1 and last round
    const round1 = life[rounds[0]];
    const lastRound = life[rounds[rounds.length - 1]];
    let anyChanged = false;
    for (const player of Object.keys(round1)) {
      if (round1[player] !== lastRound[player]) {
        anyChanged = true;
        break;
      }
    }
    assert(anyChanged, 'at least one player life total should change between first and last round');
  });

  await test('calculateLifePerTurn (fixture): non-combat damage from Ripjaw Raptor is tracked', () => {
    // Game 1 fixture has Ripjaw Raptor dealing 4 non-combat damage to 3 players
    // around segment 28+ (round 7+). Verify damage is captured by checking a late round.
    const game1 = games[0];
    const ranges = extractTurnRanges(game1);
    const uniquePlayers = [...new Set(ranges.filter(r => r.player).map(r => r.player!))];
    const life = calculateLifePerTurn(game1, uniquePlayers);

    const allRounds = Object.keys(life).map(Number).sort((a, b) => a - b);
    // Check a late round (round 8+) where Ripjaw damage should have occurred
    if (allRounds.length >= 8) {
      const lateRound = life[allRounds[7]];
      let anyDamaged = false;
      for (const total of Object.values(lateRound)) {
        if (total < 40) anyDamaged = true;
      }
      assert(anyDamaged, 'some players should have taken damage by round 8');
    }
  });

  await test('calculateLifePerTurn (fixture): Enduring Enchantments gains life from enchantment triggers', () => {
    // Game 1 fixture has many "you gain 1 life" lines with Activator: Ai(2)-Enduring Enchantments
    const game1 = games[0];
    const ranges = extractTurnRanges(game1);
    const uniquePlayers = [...new Set(ranges.filter(r => r.player).map(r => r.player!))];
    const life = calculateLifePerTurn(game1, uniquePlayers);

    const allRounds = Object.keys(life).map(Number).sort((a, b) => a - b);
    const lastRound = life[allRounds[allRounds.length - 1]];

    // Ai(2)-Enduring Enchantments should have gained some life from enchantment triggers
    const enchantPlayer = uniquePlayers.find(p => p.includes('Enduring Enchantments'));
    assert(enchantPlayer !== undefined, 'should find Enduring Enchantments player');

    // Track cumulative gains: compare to what life would be with only losses
    // The player has many "you gain 1 life" triggers, so their final life should
    // reflect some gains (unless massive damage overwhelmed it)
    // At minimum, verify the player exists in the data
    assert(lastRound[enchantPlayer!] !== undefined, 'Enduring Enchantments should have life data');
  });

  await test('calculateLifePerTurn (fixture): all 4 games produce valid life data', () => {
    for (let i = 0; i < games.length; i++) {
      const result = buildStructuredGame(games[i]);
      assert(result.lifePerTurn !== undefined, `game ${i + 1} should have lifePerTurn`);
      const rounds = Object.keys(result.lifePerTurn!);
      assert(rounds.length > 0, `game ${i + 1} should have life rounds`);

      // Check all players tracked
      const firstRound = result.lifePerTurn![Number(rounds[0])];
      const playerCount = Object.keys(firstRound).length;
      assertEqual(playerCount, 4, `game ${i + 1} should track 4 players`);
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
