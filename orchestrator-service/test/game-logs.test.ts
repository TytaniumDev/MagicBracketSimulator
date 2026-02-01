/**
 * Unit tests for game log file utilities.
 *
 * Run with: npx tsx test/game-logs.test.ts
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  parseLogFilename,
  sortLogFilenames,
  findGameLogFiles,
  countGameLogFiles,
  readGameLogs,
} from '../lib/game-logs';

// -----------------------------------------------------------------------------
// Test Utilities
// -----------------------------------------------------------------------------

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
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

function assertArrayEqual<T>(actual: T[], expected: T[], message: string) {
  if (actual.length !== expected.length) {
    throw new Error(
      `${message}: length mismatch - expected ${expected.length}, got ${actual.length}`
    );
  }
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] !== expected[i]) {
      throw new Error(
        `${message}: mismatch at index ${i} - expected "${expected[i]}", got "${actual[i]}"`
      );
    }
  }
}

/**
 * Creates a temporary directory with test game log files.
 */
function createTestLogsDir(
  jobId: string,
  files: { name: string; content: string }[]
): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'game-logs-test-'));
  for (const file of files) {
    fs.writeFileSync(path.join(tempDir, file.name), file.content);
  }
  return tempDir;
}

function cleanupDir(dir: string) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

async function runTests() {
  console.log('Running game-logs unit tests...\n');

  // -------------------------------------------------------------------------
  // parseLogFilename tests
  // -------------------------------------------------------------------------

  await test('parseLogFilename: parses single-run filename', () => {
    const result = parseLogFilename('job_abc123_game_1.txt');
    assert(result !== null, 'Expected non-null result');
    assertEqual(result!.runIndex, 0, 'runIndex');
    assertEqual(result!.gameNumber, 1, 'gameNumber');
  });

  await test('parseLogFilename: parses batched-run filename', () => {
    const result = parseLogFilename('job_abc123_run2_game_3.txt');
    assert(result !== null, 'Expected non-null result');
    assertEqual(result!.runIndex, 2, 'runIndex');
    assertEqual(result!.gameNumber, 3, 'gameNumber');
  });

  await test('parseLogFilename: returns null for invalid filename', () => {
    const result = parseLogFilename('other_file.txt');
    assert(result === null, 'Expected null for non-matching filename');
  });

  // -------------------------------------------------------------------------
  // sortLogFilenames tests
  // -------------------------------------------------------------------------

  await test('sortLogFilenames: sorts single-run files by game number', () => {
    const input = [
      'job_abc_game_3.txt',
      'job_abc_game_1.txt',
      'job_abc_game_2.txt',
    ];
    const expected = [
      'job_abc_game_1.txt',
      'job_abc_game_2.txt',
      'job_abc_game_3.txt',
    ];
    const result = sortLogFilenames(input);
    assertArrayEqual(result, expected, 'sorted order');
  });

  await test('sortLogFilenames: sorts batched files by run then game', () => {
    const input = [
      'job_abc_run1_game_2.txt',
      'job_abc_run0_game_1.txt',
      'job_abc_run1_game_1.txt',
      'job_abc_run0_game_2.txt',
    ];
    const expected = [
      'job_abc_run0_game_1.txt',
      'job_abc_run0_game_2.txt',
      'job_abc_run1_game_1.txt',
      'job_abc_run1_game_2.txt',
    ];
    const result = sortLogFilenames(input);
    assertArrayEqual(result, expected, 'sorted order');
  });

  // -------------------------------------------------------------------------
  // Batched game logs: 4 runs x 3 games = 12 total (main TDD test)
  // -------------------------------------------------------------------------

  await test('findGameLogFiles: finds all 12 batched game logs', () => {
    const jobId = 'test-job-12-games';
    const files: { name: string; content: string }[] = [];

    // Create 4 runs x 3 games = 12 files
    for (let run = 0; run < 4; run++) {
      for (let game = 1; game <= 3; game++) {
        files.push({
          name: `job_${jobId}_run${run}_game_${game}.txt`,
          content: `Game content for run ${run} game ${game}`,
        });
      }
    }

    const tempDir = createTestLogsDir(jobId, files);

    try {
      const found = findGameLogFiles(tempDir, jobId);
      assertEqual(found.length, 12, 'should find 12 files');

      // Verify order: run0_game_1, run0_game_2, run0_game_3, run1_game_1, ...
      const expectedOrder = [
        `job_${jobId}_run0_game_1.txt`,
        `job_${jobId}_run0_game_2.txt`,
        `job_${jobId}_run0_game_3.txt`,
        `job_${jobId}_run1_game_1.txt`,
        `job_${jobId}_run1_game_2.txt`,
        `job_${jobId}_run1_game_3.txt`,
        `job_${jobId}_run2_game_1.txt`,
        `job_${jobId}_run2_game_2.txt`,
        `job_${jobId}_run2_game_3.txt`,
        `job_${jobId}_run3_game_1.txt`,
        `job_${jobId}_run3_game_2.txt`,
        `job_${jobId}_run3_game_3.txt`,
      ];
      assertArrayEqual(found, expectedOrder, 'file order');
    } finally {
      cleanupDir(tempDir);
    }
  });

  await test('countGameLogFiles: counts all 12 batched game logs', () => {
    const jobId = 'test-job-count';
    const files: { name: string; content: string }[] = [];

    for (let run = 0; run < 4; run++) {
      for (let game = 1; game <= 3; game++) {
        files.push({
          name: `job_${jobId}_run${run}_game_${game}.txt`,
          content: `Game ${run}-${game}`,
        });
      }
    }

    const tempDir = createTestLogsDir(jobId, files);

    try {
      const count = countGameLogFiles(tempDir, jobId);
      assertEqual(count, 12, 'should count 12 files');
    } finally {
      cleanupDir(tempDir);
    }
  });

  await test('readGameLogs: reads all 12 batched game logs in order', () => {
    const jobId = 'test-job-read';
    const files: { name: string; content: string }[] = [];

    for (let run = 0; run < 4; run++) {
      for (let game = 1; game <= 3; game++) {
        files.push({
          name: `job_${jobId}_run${run}_game_${game}.txt`,
          content: `Content:run${run}:game${game}`,
        });
      }
    }

    const tempDir = createTestLogsDir(jobId, files);

    try {
      const logs = readGameLogs(tempDir, jobId);
      assertEqual(logs.length, 12, 'should read 12 logs');

      // Verify content order matches run/game order
      const expectedContents = [
        'Content:run0:game1',
        'Content:run0:game2',
        'Content:run0:game3',
        'Content:run1:game1',
        'Content:run1:game2',
        'Content:run1:game3',
        'Content:run2:game1',
        'Content:run2:game2',
        'Content:run2:game3',
        'Content:run3:game1',
        'Content:run3:game2',
        'Content:run3:game3',
      ];
      assertArrayEqual(logs, expectedContents, 'log content order');
    } finally {
      cleanupDir(tempDir);
    }
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  await test('findGameLogFiles: handles mixed single and batched files', () => {
    const jobId = 'mixed-job';
    // This shouldn't happen in practice, but if it does, single-run files
    // (runIndex=0) should come before batched run1 files
    const files = [
      { name: `job_${jobId}_game_1.txt`, content: 'single1' },
      { name: `job_${jobId}_game_2.txt`, content: 'single2' },
      { name: `job_${jobId}_run1_game_1.txt`, content: 'run1g1' },
    ];

    const tempDir = createTestLogsDir(jobId, files);

    try {
      const found = findGameLogFiles(tempDir, jobId);
      assertEqual(found.length, 3, 'should find 3 files');
      // Single-run files have runIndex=0, so they come first
      assertArrayEqual(
        found,
        [
          `job_${jobId}_game_1.txt`,
          `job_${jobId}_game_2.txt`,
          `job_${jobId}_run1_game_1.txt`,
        ],
        'file order'
      );
    } finally {
      cleanupDir(tempDir);
    }
  });

  await test('findGameLogFiles: ignores files for other jobs', () => {
    const jobId = 'my-job';
    const files = [
      { name: `job_${jobId}_game_1.txt`, content: 'mine' },
      { name: `job_other-job_game_1.txt`, content: 'other' },
    ];

    const tempDir = createTestLogsDir(jobId, files);

    try {
      const found = findGameLogFiles(tempDir, jobId);
      assertEqual(found.length, 1, 'should find only 1 file');
      assertEqual(found[0], `job_${jobId}_game_1.txt`, 'filename');
    } finally {
      cleanupDir(tempDir);
    }
  });

  await test('readGameLogs: skips empty files', () => {
    const jobId = 'empty-test';
    const files = [
      { name: `job_${jobId}_game_1.txt`, content: 'has content' },
      { name: `job_${jobId}_game_2.txt`, content: '   ' }, // whitespace only
      { name: `job_${jobId}_game_3.txt`, content: '' }, // empty
    ];

    const tempDir = createTestLogsDir(jobId, files);

    try {
      const logs = readGameLogs(tempDir, jobId);
      assertEqual(logs.length, 1, 'should return only non-empty logs');
      assertEqual(logs[0], 'has content', 'content');
    } finally {
      cleanupDir(tempDir);
    }
  });

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------

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
