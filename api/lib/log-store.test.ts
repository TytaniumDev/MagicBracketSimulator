/**
 * Tests for log-store.ts (LOCAL mode only).
 *
 * Uses a temp directory for LOGS_DATA_DIR, loads the real 4-game fixture,
 * and exercises the exported functions.
 *
 * Run with: npx tsx lib/log-store.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { splitConcatenatedGames } from './condenser/index';

// ---------------------------------------------------------------------------
// Test Utilities
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
// Fixture
// ---------------------------------------------------------------------------

const FIXTURE_PATH = path.join(__dirname, 'condenser', 'fixtures', 'real-4game-log.txt');

function loadFixture(): string {
  return fs.readFileSync(FIXTURE_PATH, 'utf-8');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function runTests() {
  console.log('Running log-store tests...\n');

  // Set up temp dir and configure LOGS_DATA_DIR before importing log-store
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'log-store-test-'));
  process.env.LOGS_DATA_DIR = tempDir;

  // Dynamic import so LOGS_DATA_DIR is read at import time
  const logStore = await import('./log-store');

  const rawLog = loadFixture();
  const games = splitConcatenatedGames(rawLog);

  try {
    // =========================================================================
    // uploadSingleSimulationLog
    // =========================================================================

    await test('uploadSingleSimulationLog: writes file to jobDir', async () => {
      await logStore.uploadSingleSimulationLog('job-upload-1', 'raw/game_001.txt', 'game log content');
      const filePath = path.join(tempDir, 'job-upload-1', 'game_001.txt');
      assert(fs.existsSync(filePath), `File should exist at ${filePath}`);
      assertEqual(fs.readFileSync(filePath, 'utf-8'), 'game log content', 'file content');
    });

    await test('uploadSingleSimulationLog: creates job dir if missing', async () => {
      await logStore.uploadSingleSimulationLog('job-upload-new', 'raw/game_001.txt', 'content');
      const dirPath = path.join(tempDir, 'job-upload-new');
      assert(fs.existsSync(dirPath), `Dir should exist at ${dirPath}`);
    });

    await test('uploadSingleSimulationLog: strips raw/ prefix from filename', async () => {
      await logStore.uploadSingleSimulationLog('job-upload-strip', 'raw/game_002.txt', 'data');
      const withPrefix = path.join(tempDir, 'job-upload-strip', 'raw', 'game_002.txt');
      const withoutPrefix = path.join(tempDir, 'job-upload-strip', 'game_002.txt');
      assert(!fs.existsSync(withPrefix), 'Should not have raw/ subdirectory');
      assert(fs.existsSync(withoutPrefix), 'Should be stored without raw/ prefix');
    });

    await test('uploadSingleSimulationLog: filename without raw/ prefix stored as-is', async () => {
      await logStore.uploadSingleSimulationLog('job-upload-nopfx', 'game_003.txt', 'direct');
      const filePath = path.join(tempDir, 'job-upload-nopfx', 'game_003.txt');
      assert(fs.existsSync(filePath), 'Should be stored as-is');
    });

    await test('uploadSingleSimulationLog: rejects log text over MAX_LOG_BYTES', async () => {
      const maxBytes = logStore.MAX_LOG_BYTES;
      assert(typeof maxBytes === 'number' && maxBytes > 0, 'MAX_LOG_BYTES must be exported');
      const oversize = 'a'.repeat(maxBytes + 1);
      let thrown: Error | null = null;
      try {
        await logStore.uploadSingleSimulationLog('job-upload-oversize', 'raw/game_001.txt', oversize);
      } catch (err) {
        thrown = err as Error;
      }
      assert(thrown !== null, 'should throw for oversize log');
      assert(
        /too large|exceeds|max/i.test(thrown!.message),
        `error message should indicate size; got: ${thrown!.message}`
      );
      const filePath = path.join(tempDir, 'job-upload-oversize', 'game_001.txt');
      assert(!fs.existsSync(filePath), 'oversize log must not be written to disk');
    });

    await test('uploadSingleSimulationLog: accepts log text exactly at MAX_LOG_BYTES', async () => {
      const exact = 'a'.repeat(logStore.MAX_LOG_BYTES);
      await logStore.uploadSingleSimulationLog('job-upload-exact', 'raw/game_001.txt', exact);
      const filePath = path.join(tempDir, 'job-upload-exact', 'game_001.txt');
      assert(fs.existsSync(filePath), 'at-limit log should be written');
      assertEqual(fs.statSync(filePath).size, logStore.MAX_LOG_BYTES, 'file size should equal MAX_LOG_BYTES');
    });

    // =========================================================================
    // forEachRawGame
    // =========================================================================

    const visitAll = async (jobId: string) => {
      const seen: { game: string; file: string; index: number }[] = [];
      const count = await logStore.forEachRawGame(jobId, (game, file, index) => seen.push({ game, file, index }));
      return { count, seen };
    };

    await test('forEachRawGame: visits nothing for a nonexistent job dir', async () => {
      const { count } = await visitAll('nonexistent-job');
      assertEqual(count, 0, 'games visited');
    });

    await test('forEachRawGame: visits game files in filename order, ignoring other files', async () => {
      const jobId = 'job-sorted-games';
      const jobDir = path.join(tempDir, jobId);
      fs.mkdirSync(jobDir, { recursive: true });
      fs.writeFileSync(path.join(jobDir, 'game_002.txt'), 'game two', 'utf-8');
      fs.writeFileSync(path.join(jobDir, 'game_001.txt'), 'game one', 'utf-8');
      fs.writeFileSync(path.join(jobDir, 'games.json'), '{}', 'utf-8');
      fs.writeFileSync(path.join(jobDir, 'readme.txt'), 'ignore me', 'utf-8');
      const { count, seen } = await visitAll(jobId);
      assertEqual(count, 2, 'games visited');
      assertEqual(seen.map((s) => s.game).join(','), 'game one,game two', 'order');
    });

    await test("forEachRawGame: splits a simulation's file into its games", async () => {
      const jobId = 'job-split-sim';
      await logStore.uploadSingleSimulationLog(jobId, 'raw/game_001.txt', rawLog);
      await logStore.uploadSingleSimulationLog(jobId, 'raw/game_002.txt', games[0]);
      const { count, seen } = await visitAll(jobId);
      assertEqual(count, 5, 'games');
      assertEqual(seen[0].game, games[0], 'first game');
      assertEqual(seen[3].index, 3, 'fourth game of the first file');
      assertEqual(seen[4].file, 'game_002.txt', 'second file');
      assertEqual(seen[4].index, 0, 'first game of the second file');
    });

    // =========================================================================
    // buildGameIndex / saveGameIndex / getGameIndex
    // =========================================================================

    await test('buildGameIndex: null when the job has no logs', async () => {
      assertEqual(await logStore.buildGameIndex('nonexistent-index'), null, 'index');
    });

    await test('buildGameIndex: one entry per game with its winner, and visits each game', async () => {
      const jobId = 'job-index-build';
      await logStore.uploadSingleSimulationLog(jobId, 'raw/game_001.txt', rawLog);
      const visited: string[] = [];
      const index = await logStore.buildGameIndex(jobId, ['A', 'B', 'C', 'D'], (game) => visited.push(game));
      assert(index !== null, 'index');
      assertEqual(index!.games.length, 4, 'games');
      assertEqual(visited.length, 4, 'visited games');
      assertEqual(index!.deckNames?.join(','), 'A,B,C,D', 'deck names');
      assert(index!.games.every((g) => g.file === 'game_001.txt'), 'all in the one file');
      assert(index!.games.some((g) => typeof g.winner === 'string'), 'winners found');
    });

    await test('getGameIndex: returns the saved index', async () => {
      const jobId = 'job-index-saved';
      await logStore.saveGameIndex(jobId, { deckNames: ['A'], games: [{ file: 'game_001.txt', index: 0, winner: 'Ai(1)-A' }] });
      const index = await logStore.getGameIndex(jobId);
      assertEqual(index?.games.length, 1, 'games');
      assertEqual(index?.games[0].winner, 'Ai(1)-A', 'winner');
    });

    await test('getGameIndex: builds from raw logs when none is saved, using the deck name hint', async () => {
      const jobId = 'job-index-fallback';
      await logStore.uploadSingleSimulationLog(jobId, 'raw/game_001.txt', rawLog);
      const index = await logStore.getGameIndex(jobId, ['X', 'Y', 'Z', 'W']);
      assertEqual(index?.games.length, 4, 'games');
      assertEqual(index?.deckNames?.[0], 'X', 'hint');
      assert(!fs.existsSync(path.join(tempDir, jobId, 'games.json')), 'a read does not save the index');
    });

    // =========================================================================
    // getGameLog
    // =========================================================================

    await test('getGameLog: one game with its raw, condensed and structured views', async () => {
      const jobId = 'job-game-log';
      await logStore.uploadSingleSimulationLog(jobId, 'raw/game_001.txt', rawLog);
      await logStore.saveGameIndex(jobId, (await logStore.buildGameIndex(jobId, ['A', 'B', 'C', 'D']))!);
      const game = await logStore.getGameLog(jobId, 2);
      assert(game !== null, 'game');
      assertEqual(game!.raw, games[2], 'raw log of the third game');
      assert(game!.condensed.turnCount > 0, 'condensed');
      assert(game!.structured.totalTurns > 0, 'structured');
    });

    await test('getGameLog: null past the last game or before the first', async () => {
      const jobId = 'job-game-log-range';
      await logStore.uploadSingleSimulationLog(jobId, 'raw/game_001.txt', rawLog);
      assertEqual(await logStore.getGameLog(jobId, 4), null, 'past the end');
      assertEqual(await logStore.getGameLog(jobId, -1), null, 'negative');
      assertEqual(await logStore.getGameLog('nonexistent-game-log', 0), null, 'no logs');
    });

  } finally {
    // Cleanup temp dir
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

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
