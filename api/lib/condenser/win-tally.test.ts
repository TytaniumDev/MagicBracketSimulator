/**
 * Tests for win tally computation and gamesCompleted derivation.
 *
 * Covers the `endsWith('-DeckName')` matching pattern (used identically in
 * structured.ts:229, condenser.test.ts:211, and frontend/JobStatus.tsx:329+380)
 * and the gamesCompleted counting logic.
 *
 * Run with: npx tsx lib/condenser/win-tally.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { splitConcatenatedGames } from './patterns';
import { structureGames } from './index';
import { resolveWinnerName } from './deck-match';
import type { SimulationStatus, SimulationState } from '../types';
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

// Use the shared resolveWinnerName from deck-match.ts (canonical matching logic)
const matchWinner = resolveWinnerName;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'real-4game-log.txt');

function loadFixture(): string {
  return fs.readFileSync(FIXTURE_PATH, 'utf-8');
}

function sim(state: SimulationState, index: number = 0): SimulationStatus {
  return {
    simId: `sim_${String(index).padStart(3, '0')}`,
    index,
    state,
  };
}

/**
 * Compute gamesCompleted from simulation statuses, mirroring the frontend logic.
 * gamesCompleted = number of COMPLETED sims × GAMES_PER_CONTAINER
 */
function computeGamesCompleted(sims: SimulationStatus[]): number {
  const completedCount = sims.filter((s) => s.state === 'COMPLETED').length;
  return completedCount * GAMES_PER_CONTAINER;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function runTests() {
  console.log('Running win tally + gamesCompleted tests...\n');

  const deckNames = ['Explorers of the Deep', 'Doran Big Butts', 'Enduring Enchantments', 'Graveyard Shift'];

  // =========================================================================
  // matchWinner
  // =========================================================================

  await test('matchWinner: clean name matches directly', () => {
    assertEqual(matchWinner('Doran Big Butts', deckNames), 'Doran Big Butts', 'direct match');
  });

  await test('matchWinner: Ai(N)-prefixed name matches via endsWith', () => {
    assertEqual(
      matchWinner('Ai(2)-Enduring Enchantments', deckNames),
      'Enduring Enchantments',
      'Ai prefix match'
    );
  });

  await test('matchWinner: unrecognized winner returns as-is', () => {
    assertEqual(
      matchWinner('Ai(5)-Unknown Deck', deckNames),
      'Ai(5)-Unknown Deck',
      'no match returns original'
    );
  });

  await test('matchWinner: hyphenated deck name matches correctly', () => {
    const names = ['Some-Hyphenated-Name', 'Other Deck'];
    assertEqual(
      matchWinner('Ai(1)-Some-Hyphenated-Name', names),
      'Some-Hyphenated-Name',
      'hyphenated match'
    );
  });

  // =========================================================================
  // Win tally from fixture
  // =========================================================================

  await test('win tally from fixture: Explorers=1, Doran=1, Enduring=2', () => {
    const rawLog = loadFixture();
    const games = splitConcatenatedGames(rawLog);
    const structured = structureGames(games, deckNames);

    const tally: Record<string, number> = {};
    for (const name of deckNames) tally[name] = 0;

    for (const game of structured) {
      if (game.winner) {
        const matched = matchWinner(game.winner, deckNames);
        if (tally[matched] !== undefined) tally[matched]++;
      }
    }

    assertEqual(tally['Explorers of the Deep'], 1, 'Explorers wins');
    assertEqual(tally['Doran Big Butts'], 1, 'Doran wins');
    assertEqual(tally['Enduring Enchantments'], 2, 'Enduring wins');
  });

  await test('win tally: total wins == total games with winners', () => {
    const rawLog = loadFixture();
    const games = splitConcatenatedGames(rawLog);
    const structured = structureGames(games, deckNames);

    const gamesWithWinners = structured.filter((g) => g.winner !== undefined).length;
    let totalWins = 0;

    const tally: Record<string, number> = {};
    for (const game of structured) {
      if (game.winner) {
        const matched = matchWinner(game.winner, deckNames);
        tally[matched] = (tally[matched] ?? 0) + 1;
      }
    }
    for (const count of Object.values(tally)) totalWins += count;

    assertEqual(totalWins, gamesWithWinners, 'total wins should equal games with winners');
  });

  // =========================================================================
  // gamesCompleted derivation
  // =========================================================================

  await test('gamesCompleted: COMPLETED sims * GAMES_PER_CONTAINER', () => {
    const sims = [sim('COMPLETED', 0), sim('COMPLETED', 1), sim('COMPLETED', 2)];
    assertEqual(computeGamesCompleted(sims), 3 * GAMES_PER_CONTAINER, '3 completed');
  });

  await test('gamesCompleted: ignores FAILED and PENDING', () => {
    const sims = [
      sim('COMPLETED', 0),
      sim('FAILED', 1),
      sim('PENDING', 2),
      sim('COMPLETED', 3),
    ];
    assertEqual(computeGamesCompleted(sims), 2 * GAMES_PER_CONTAINER, 'only COMPLETED counted');
  });

  await test('gamesCompleted: 0 when no sims completed', () => {
    const sims = [sim('PENDING', 0), sim('PENDING', 1), sim('RUNNING', 2)];
    assertEqual(computeGamesCompleted(sims), 0, 'no completed sims');
  });

  await test('gamesCompleted: falls back when no sim data', () => {
    const sims: SimulationStatus[] = [];
    const fallback = 42;
    // When sims array is empty, frontend uses fallback from job.gamesCompleted
    const gamesCompleted = sims.length > 0 ? computeGamesCompleted(sims) : fallback;
    assertEqual(gamesCompleted, 42, 'empty sims uses fallback');
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
