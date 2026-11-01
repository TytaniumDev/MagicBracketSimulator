/**
 * Tests for the game-count helpers in job-utils.ts.
 *
 * Run with: npx tsx lib/job-utils.test.ts
 */
import { missingGames, reportedGameCount } from './job-utils';

let failed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  if (actual === expected) {
    console.log(`✓ ${name}`);
  } else {
    failed++;
    console.log(`✗ ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

check('reportedGameCount counts one game per winner', reportedGameCount({ winners: ['A', 'B', 'A', 'C'] }), 4);
check('reportedGameCount counts a single winner as one game', reportedGameCount({ winner: 'A' }), 1);
check('reportedGameCount prefers winners over winner', reportedGameCount({ winner: 'A', winners: ['A', 'B'] }), 2);
check('reportedGameCount is 0 with no winners', reportedGameCount({}), 0);

check('missingGames is 0 when every sim played 4 games', missingGames(50, 200), 0);
check('missingGames counts the shortfall when sims played 1 game each', missingGames(50, 50), 150);
check('missingGames never goes negative', missingGames(1, 9), 0);

if (failed > 0) {
  console.log(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('\nAll tests passed!');
