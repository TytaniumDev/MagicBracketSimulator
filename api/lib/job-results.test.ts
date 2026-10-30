/**
 * Tests for computeJobResults: per-seat wins and average winning turn.
 *
 * Run with: npx tsx lib/job-results.test.ts
 */
import { computeJobResults } from './job-results';

let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    failed++;
    console.log(`✗ ${name}\n  Error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}: expected ${e}, got ${a}`);
}

const seats = ['Alpha', 'Beta', 'Gamma', 'Delta'];

test('counts wins and averages winning turns per seat', () => {
  const results = computeJobResults(
    [
      { winner: 'Ai(1)-Alpha', winningTurn: 7 },
      { winner: 'Ai(1)-Alpha', winningTurn: 8 },
      { winner: 'Ai(3)-Gamma', winningTurn: 10 },
      { winner: undefined, winningTurn: undefined },
    ],
    seats,
  );
  assertEqual(results, {
    gamesPlayed: 4,
    seats: [
      { wins: 2, avgWinTurn: 7.5 },
      { wins: 0, avgWinTurn: null },
      { wins: 1, avgWinTurn: 10 },
      { wins: 0, avgWinTurn: null },
    ],
  }, 'results');
});

test('the same deck in two seats keeps separate results', () => {
  const results = computeJobResults(
    [
      { winner: 'Ai(1)-Alpha', winningTurn: 6 },
      { winner: 'Ai(4)-Alpha', winningTurn: 9 },
      { winner: 'Ai(4)-Alpha', winningTurn: 9 },
    ],
    ['Alpha', 'Beta', 'Gamma', 'Alpha'],
  );
  assertEqual(results.seats.map((s) => s.wins), [1, 0, 0, 2], 'wins');
});

test('a winner matching no seat counts as a game but no win', () => {
  const results = computeJobResults([{ winner: 'Ai(2)-Stranger', winningTurn: 5 }], seats);
  assertEqual(results.gamesPlayed, 1, 'games');
  assertEqual(results.seats.every((s) => s.wins === 0), true, 'no wins');
});

if (failed > 0) process.exit(1);
console.log('\nAll tests passed!');
