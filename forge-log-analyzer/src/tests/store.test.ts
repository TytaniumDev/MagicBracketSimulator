/**
 * Store tests - job log retrieval and concatenated-game splitting.
 *
 * Uses real job data when present: job c998d985-66d3-4048-9d97-80e6911123e4
 * had 4 parallel Docker runs; each run produced one file with 3 games concatenated,
 * so we have 4 files that must be expanded to 12 games.
 *
 * Run with: npm test (or tsx src/tests/store.test.ts)
 */

import { describe, test } from 'node:test';
import assert from 'node:assert';
import { getJobLogs } from '../store.js';

const JOB_ID_BATCHED_4_FILES_12_GAMES = 'c998d985-66d3-4048-9d97-80e6911123e4';

describe('Store - batched job c998d985 (4 files, 12 games)', () => {
  test('getJobLogs returns 12 games for job c998d985-66d3-4048-9d97-80e6911123e4', (t) => {
    const data = getJobLogs(JOB_ID_BATCHED_4_FILES_12_GAMES);
    if (!data) {
      t.skip(
        `Job ${JOB_ID_BATCHED_4_FILES_12_GAMES} not in data dir (optional fixture). ` +
          'Add data/c998d985-66d3-4048-9d97-80e6911123e4/ with game_001..004.txt to run this test.'
      );
      return;
    }
    assert.strictEqual(
      data.gameLogs.length,
      12,
      `Expected 12 games (4 files × 3 games each), got ${data.gameLogs.length}. ` +
        'Each stored file contains 3 concatenated games and must be split.'
    );
  });
});
