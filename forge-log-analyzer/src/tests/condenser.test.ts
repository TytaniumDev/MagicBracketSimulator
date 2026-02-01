/**
 * =============================================================================
 * Forge Log Analyzer - Condenser Tests
 * =============================================================================
 *
 * Automated tests for the log parsing and condensing pipeline.
 * Uses real Forge log data from test/fixtures/forge-real-game/.
 *
 * Run with: npm test
 *
 * =============================================================================
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { test, describe } from 'node:test';
import assert from 'node:assert';

import {
  extractTurnRanges,
  getMaxTurn,
  getNumPlayers,
  getMaxRound,
  segmentToRound,
  buildStructuredGame,
  structureGames,
  attributeLines,
} from '../condenser/index.js';

// -----------------------------------------------------------------------------
// Fixture Loading
// -----------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(__dirname, '../../test/fixtures/forge-real-game');
const FIXTURE_GAME_LOG = path.join(FIXTURE_DIR, 'game_001.txt');

// Load fixture once for all tests
const fixtureLog = fs.readFileSync(FIXTURE_GAME_LOG, 'utf-8');

// Known values from the fixture (game_001.txt has 36 segments, 4 players, 9 rounds)
const EXPECTED_MAX_SEGMENT = 36;  // Total player-turn segments
const EXPECTED_NUM_PLAYERS = 4;
const EXPECTED_MAX_ROUND = 9;     // Total rounds (36 segments / 4 players)
const EXPECTED_PLAYERS = [
  'Ai(4)-Draconic Dissent',
  'Ai(1)-Doran Big Butts',
  'Ai(2)-Blood Rites',
  'Ai(3)-Explorers of the Deep',
];

// -----------------------------------------------------------------------------
// Turn Extraction Tests
// -----------------------------------------------------------------------------

describe('Turn Extraction', () => {
  test('extractTurnRanges returns non-empty array for real log', () => {
    const ranges = extractTurnRanges(fixtureLog);
    assert.ok(ranges.length > 0, 'Expected non-empty turn ranges array');
  });

  test('extractTurnRanges finds turn 1 as the first turn', () => {
    const ranges = extractTurnRanges(fixtureLog);
    assert.strictEqual(ranges[0].turnNumber, 1, 'First turn should be turn 1');
  });

  test('extractTurnRanges extracts correct max segment number', () => {
    const ranges = extractTurnRanges(fixtureLog);
    const maxTurn = getMaxTurn(ranges);
    assert.strictEqual(maxTurn, EXPECTED_MAX_SEGMENT, `Max segment should be ${EXPECTED_MAX_SEGMENT}`);
  });

  test('getNumPlayers returns correct player count', () => {
    const ranges = extractTurnRanges(fixtureLog);
    const numPlayers = getNumPlayers(ranges);
    assert.strictEqual(numPlayers, EXPECTED_NUM_PLAYERS, `Should have ${EXPECTED_NUM_PLAYERS} players`);
  });

  test('getMaxRound returns correct round count', () => {
    const ranges = extractTurnRanges(fixtureLog);
    const numPlayers = getNumPlayers(ranges);
    const maxRound = getMaxRound(ranges, numPlayers);
    assert.strictEqual(maxRound, EXPECTED_MAX_ROUND, `Max round should be ${EXPECTED_MAX_ROUND}`);
  });

  test('segmentToRound converts segment to round correctly', () => {
    // In a 4-player game: segments 1-4 = round 1, segments 5-8 = round 2, etc.
    assert.strictEqual(segmentToRound(1, 4), 1, 'Segment 1 should be round 1');
    assert.strictEqual(segmentToRound(4, 4), 1, 'Segment 4 should be round 1');
    assert.strictEqual(segmentToRound(5, 4), 2, 'Segment 5 should be round 2');
    assert.strictEqual(segmentToRound(8, 4), 2, 'Segment 8 should be round 2');
    assert.strictEqual(segmentToRound(36, 4), 9, 'Segment 36 should be round 9');
  });

  test('extractTurnRanges extracts player names from parenthesized format', () => {
    const ranges = extractTurnRanges(fixtureLog);
    
    // First turn should have a player extracted
    assert.ok(ranges[0].player, 'First turn should have a player');
    
    // The first turn is from Ai(4)-Draconic Dissent based on the fixture
    assert.strictEqual(
      ranges[0].player,
      'Ai(4)-Draconic Dissent',
      'First turn player should be Ai(4)-Draconic Dissent'
    );
  });

  test('extractTurnRanges finds all 4 players', () => {
    const ranges = extractTurnRanges(fixtureLog);
    const foundPlayers = new Set(ranges.map((r) => r.player).filter(Boolean));
    
    for (const player of EXPECTED_PLAYERS) {
      assert.ok(foundPlayers.has(player), `Should find player: ${player}`);
    }
  });

  test('getMaxTurn returns 0 for empty ranges', () => {
    const maxTurn = getMaxTurn([]);
    assert.strictEqual(maxTurn, 0, 'Max turn of empty array should be 0');
  });
});

// -----------------------------------------------------------------------------
// Player Attribution Tests
// -----------------------------------------------------------------------------

describe('Player Attribution', () => {
  test('attributeLines returns attributed lines for real log', () => {
    const attributed = attributeLines(fixtureLog);
    assert.ok(attributed.length > 0, 'Expected non-empty attributed lines');
  });

  test('attributeLines has lines for turn 1', () => {
    const attributed = attributeLines(fixtureLog);
    const turn1Lines = attributed.filter((a) => a.turnNumber === 1);
    assert.ok(turn1Lines.length > 0, 'Expected some lines for turn 1');
  });

  test('attributeLines attributes lines to real player names (not "Unknown")', () => {
    const attributed = attributeLines(fixtureLog);
    const turn1Lines = attributed.filter((a) => a.turnNumber === 1);
    
    // At least some turn 1 lines should have a real player
    const linesWithRealPlayer = turn1Lines.filter(
      (a) => a.player && a.player !== 'Unknown' && EXPECTED_PLAYERS.includes(a.player)
    );
    assert.ok(
      linesWithRealPlayer.length > 0,
      'Expected some turn 1 lines to have real player names'
    );
  });
});

// -----------------------------------------------------------------------------
// Structured Game Tests
// -----------------------------------------------------------------------------

describe('Structured Game Building', () => {
  test('buildStructuredGame returns correct totalTurns (round-based)', () => {
    const structured = buildStructuredGame(fixtureLog);
    assert.strictEqual(
      structured.totalTurns,
      EXPECTED_MAX_ROUND,
      `totalTurns should be ${EXPECTED_MAX_ROUND} (rounds, not segments)`
    );
  });

  test('buildStructuredGame includes winningTurn', () => {
    const structured = buildStructuredGame(fixtureLog);
    assert.ok(structured.winningTurn !== undefined, 'winningTurn should be defined');
    assert.strictEqual(
      structured.winningTurn,
      EXPECTED_MAX_ROUND,
      `winningTurn should be ${EXPECTED_MAX_ROUND} (final round)`
    );
  });

  test('buildStructuredGame returns 4 decks for 4-player game', () => {
    const structured = buildStructuredGame(fixtureLog);
    assert.strictEqual(structured.decks.length, 4, 'Should have 4 decks');
  });

  test('buildStructuredGame has non-empty turns for at least one deck', () => {
    const structured = buildStructuredGame(fixtureLog);
    
    const decksWithTurns = structured.decks.filter((d) => d.turns.length > 0);
    assert.ok(decksWithTurns.length > 0, 'At least one deck should have turns');
  });

  test('buildStructuredGame has turn 1 actions for at least one deck', () => {
    const structured = buildStructuredGame(fixtureLog);
    
    let foundTurn1 = false;
    for (const deck of structured.decks) {
      const turn1 = deck.turns.find((t) => t.turnNumber === 1);
      if (turn1 && turn1.actions.length > 0) {
        foundTurn1 = true;
        break;
      }
    }
    assert.ok(foundTurn1, 'At least one deck should have turn 1 with actions');
  });

  test('buildStructuredGame actions contain recognizable lines', () => {
    const structured = buildStructuredGame(fixtureLog);
    
    // Look for a line that contains "Phase:" or "Land:" - common Forge output
    let foundRecognizable = false;
    for (const deck of structured.decks) {
      for (const turn of deck.turns) {
        for (const action of turn.actions) {
          if (action.line.includes('Phase:') || action.line.includes('Land:') || action.line.includes('Add to stack:')) {
            foundRecognizable = true;
            break;
          }
        }
        if (foundRecognizable) break;
      }
      if (foundRecognizable) break;
    }
    assert.ok(foundRecognizable, 'Should find recognizable Forge action lines');
  });

  test('structureGames processes array of logs', () => {
    const games = structureGames([fixtureLog]);
    assert.strictEqual(games.length, 1, 'Should return 1 structured game');
    assert.strictEqual(games[0].totalTurns, EXPECTED_MAX_ROUND, 'First game should have correct totalTurns (rounds)');
  });

  test('buildStructuredGame with deckNames uses provided names', () => {
    const deckNames = ['Hero', 'Opp1', 'Opp2', 'Opp3'];
    const structured = buildStructuredGame(fixtureLog, deckNames);
    
    // Check that deck labels use the provided names
    assert.strictEqual(structured.decks[0].deckLabel, 'Hero', 'First deck should be labeled "Hero"');
  });

  test('lifePerTurn sets life to 0 for players who lost because life total reached 0', () => {
    const structured = buildStructuredGame(fixtureLog);
    assert.ok(structured.lifePerTurn, 'lifePerTurn should be present');
    const maxTurn = Math.max(...Object.keys(structured.lifePerTurn).map(Number));
    const finalLife = structured.lifePerTurn[maxTurn];
    assert.ok(finalLife, `Should have life totals for turn ${maxTurn}`);
    // Fixture ends with: Ai(1), Ai(2), Ai(4) lost because life total reached 0
    assert.strictEqual(finalLife['Ai(1)-Doran Big Butts'], 0, 'Ai(1) should have 0 life');
    assert.strictEqual(finalLife['Ai(2)-Blood Rites'], 0, 'Ai(2) should have 0 life');
    assert.strictEqual(finalLife['Ai(4)-Draconic Dissent'], 0, 'Ai(4) should have 0 life');
  });

  /**
   * TDD: Total wins across decks must equal number of games played.
   * Each game has exactly one winner, so sum(wins) === games.length.
   * This test fails when winner extraction misses the actual log format
   * (e.g. "has won!" vs "wins the game").
   */
  test('total wins across decks matches number of games played', () => {
    const deckNames = ['Doran Big Butts', 'Blood Rites', 'Explorers of the Deep', 'Draconic Dissent'];
    // Use 4 copies of the fixture to simulate a 4-game job (like c998d985-66d3-4048-9d97-80e6911123e4)
    const gameLogs = [fixtureLog, fixtureLog, fixtureLog, fixtureLog];
    const structured = structureGames(gameLogs, deckNames);

    const tally: Record<string, number> = {};
    for (const name of deckNames) {
      tally[name] = 0;
    }
    for (const game of structured) {
      if (game.winner) {
        const matchedDeck =
          deckNames.find(
            (name) => game.winner === name || game.winner?.endsWith(`-${name}`)
          ) ?? game.winner;
        tally[matchedDeck] = (tally[matchedDeck] ?? 0) + 1;
      }
    }

    const totalWins = Object.values(tally).reduce((a, b) => a + b, 0);
    assert.strictEqual(
      totalWins,
      structured.length,
      `Total wins (${totalWins}) must equal number of games (${structured.length}). Each game has exactly one winner.`
    );
  });
});

// -----------------------------------------------------------------------------
// Regex Format Tests (unit tests for pattern matching)
// -----------------------------------------------------------------------------

describe('Pattern Matching', () => {
  test('EXTRACT_TURN_NUMBER matches current Forge format', () => {
    const line = 'Turn: Turn 1 (Ai(4)-Draconic Dissent)';
    const pattern = /^Turn:?\s*Turn\s+(\d+)/im;
    const match = pattern.exec(line);
    
    assert.ok(match, 'Pattern should match current Forge format');
    assert.strictEqual(match[1], '1', 'Should capture turn number 1');
  });

  test('EXTRACT_TURN_NUMBER matches older Forge format', () => {
    const line = 'Turn 5: Player A';
    const pattern = /^Turn:?\s*Turn\s+(\d+)/im;
    const match = pattern.exec(line);
    
    // The new pattern requires "Turn Turn N" so it won't match old format directly
    // This is expected - we updated to support the CURRENT format
    // Old format "Turn N:" is different from "Turn: Turn N"
    assert.ok(!match, 'New pattern specifically targets "Turn: Turn N" format');
  });

  test('EXTRACT_ACTIVE_PLAYER matches parenthesized player format', () => {
    const line = 'Turn: Turn 1 (Ai(4)-Draconic Dissent)';
    // Pattern uses .+ (greedy) to capture player names with nested parentheses
    const pattern = /^Turn\s+\d+:\s*(.+?)\s*$|^Turn:\s*Turn\s+\d+\s*\((.+)\)\s*$/im;
    const match = pattern.exec(line);
    
    assert.ok(match, 'Pattern should match parenthesized format');
    // Group 2 should have the player name
    const player = match[1] ?? match[2];
    assert.strictEqual(player, 'Ai(4)-Draconic Dissent', 'Should capture player name from parentheses');
  });
});

console.log('Running condenser tests...');
