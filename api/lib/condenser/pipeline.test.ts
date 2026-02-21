/**
 * End-to-end pipeline consistency tests.
 *
 * Verifies that raw logs → splitConcatenatedGames → condenseGames + structureGames
 * → win tallies all agree. This is the test that would have caught the
 * gamesCompleted regression.
 *
 * Run with: npx tsx lib/condenser/pipeline.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { splitConcatenatedGames } from './patterns';
import { condenseGames, structureGames } from './index';
import { resolveWinnerName } from './deck-match';
import { GAMES_PER_CONTAINER } from '../types';

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
// Helpers
// ---------------------------------------------------------------------------

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'real-4game-log.txt');

function loadFixture(): string {
  return fs.readFileSync(FIXTURE_PATH, 'utf-8');
}

// Use the shared resolveWinnerName from deck-match.ts (canonical matching logic)
const matchWinner = resolveWinnerName;

/** Build a win tally from an array of winner strings. */
function buildTally(winners: (string | undefined)[], deckNames: string[]): Record<string, number> {
  const tally: Record<string, number> = {};
  for (const name of deckNames) tally[name] = 0;
  for (const w of winners) {
    if (w) {
      const matched = matchWinner(w, deckNames);
      if (tally[matched] !== undefined) tally[matched]++;
    }
  }
  return tally;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function runTests() {
  console.log('Running pipeline consistency tests...\n');

  const rawLog = loadFixture();
  const deckNames = ['Explorers of the Deep', 'Doran Big Butts', 'Enduring Enchantments', 'Graveyard Shift'];

  // Run the full pipeline
  const games = splitConcatenatedGames(rawLog);
  const condensed = condenseGames(games);
  const structured = structureGames(games, deckNames);

  // =========================================================================
  // Game count consistency
  // =========================================================================

  await test('split → condense → structure: same game count', () => {
    assertEqual(games.length, 4, 'split count');
    assertEqual(condensed.length, 4, 'condensed count');
    assertEqual(structured.length, 4, 'structured count');
  });

  // =========================================================================
  // Winner consistency
  // =========================================================================

  await test('condensed winners match structured winners', () => {
    for (let i = 0; i < games.length; i++) {
      const cWinner = condensed[i].winner;
      const sWinner = structured[i].winner;
      assertEqual(cWinner, sWinner, `Game ${i + 1} winner mismatch`);
    }
  });

  // =========================================================================
  // Winning turn consistency
  // =========================================================================

  await test('condensed winningTurns match structured winningTurns', () => {
    for (let i = 0; i < games.length; i++) {
      const cTurn = condensed[i].winningTurn;
      const sTurn = structured[i].winningTurn;
      assertEqual(cTurn, sTurn, `Game ${i + 1} winningTurn mismatch`);
    }
  });

  // =========================================================================
  // Win tally consistency
  // =========================================================================

  await test('win tally from condensed == win tally from structured', () => {
    const condensedTally = buildTally(condensed.map((c) => c.winner), deckNames);
    const structuredTally = buildTally(structured.map((s) => s.winner), deckNames);

    for (const name of deckNames) {
      assertEqual(
        condensedTally[name],
        structuredTally[name],
        `${name} tally mismatch`
      );
    }
  });

  // =========================================================================
  // No games lost or double-counted
  // =========================================================================

  await test('total wins == total games with winners', () => {
    const condensedWinners = condensed.filter((c) => c.winner !== undefined);
    const condensedTally = buildTally(condensed.map((c) => c.winner), deckNames);
    const totalWins = Object.values(condensedTally).reduce((sum, n) => sum + n, 0);
    assertEqual(totalWins, condensedWinners.length, 'no games lost or double-counted');
  });

  // =========================================================================
  // gamesCompleted consistency
  // =========================================================================

  await test('sim-based gamesCompleted matches actual game count', () => {
    // N games from the fixture means N / GAMES_PER_CONTAINER containers would be COMPLETED.
    // gamesCompleted = completedContainers * GAMES_PER_CONTAINER should round-trip back to N.
    const numGames = games.length;
    const numContainers = Math.ceil(numGames / GAMES_PER_CONTAINER);
    const gamesCompleted = numContainers * GAMES_PER_CONTAINER;
    assertEqual(gamesCompleted, numGames, 'gamesCompleted round-trip');
  });

  // =========================================================================
  // Clean labels
  // =========================================================================

  await test('structureGames with deckNames produces clean labels', () => {
    // The first deckNames.length decks should have clean labels.
    // buildStructuredGame may append extra unmatched players beyond that.
    for (let i = 0; i < structured.length; i++) {
      for (let d = 0; d < deckNames.length; d++) {
        assert(
          !structured[i].decks[d].deckLabel.startsWith('Ai('),
          `Game ${i + 1} deck ${d} "${structured[i].decks[d].deckLabel}" should not have Ai() prefix`
        );
        assertEqual(
          structured[i].decks[d].deckLabel,
          deckNames[d],
          `Game ${i + 1} deck ${d} label`
        );
      }
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
