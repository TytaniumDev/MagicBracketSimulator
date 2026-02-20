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
import { extractWinner } from './turns';

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

  await test('buildStructuredGame: totalTurns is a valid round number', () => {
    const result = buildStructuredGame(games[0]);
    assert(result.totalTurns > 0, `totalTurns should be > 0, got ${result.totalTurns}`);
    assert(result.totalTurns <= 20, `totalTurns should be <= 20 (round number), got ${result.totalTurns}`);
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

  await test('buildStructuredGame: winningTurn is a valid round number', () => {
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
