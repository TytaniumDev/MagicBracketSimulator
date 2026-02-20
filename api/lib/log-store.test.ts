/**
 * Tests for log-store.ts (LOCAL mode only).
 *
 * Uses a temp directory for LOGS_DATA_DIR, loads the real 4-game fixture,
 * and exercises all 5 exported functions.
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

    // =========================================================================
    // getRawLogs
    // =========================================================================

    await test('getRawLogs: returns null for nonexistent job dir', async () => {
      const result = await logStore.getRawLogs('nonexistent-job');
      assertEqual(result, null, 'should return null');
    });

    await test('getRawLogs: returns null when dir has no game_NNN.txt files', async () => {
      const jobId = 'job-no-games';
      const jobDir = path.join(tempDir, jobId);
      fs.mkdirSync(jobDir, { recursive: true });
      fs.writeFileSync(path.join(jobDir, 'meta.json'), '{}', 'utf-8');
      const result = await logStore.getRawLogs(jobId);
      assertEqual(result, null, 'should return null when no game files');
    });

    await test('getRawLogs: returns sorted game file contents', async () => {
      const jobId = 'job-sorted-games';
      const jobDir = path.join(tempDir, jobId);
      fs.mkdirSync(jobDir, { recursive: true });
      fs.writeFileSync(path.join(jobDir, 'game_002.txt'), 'game two', 'utf-8');
      fs.writeFileSync(path.join(jobDir, 'game_001.txt'), 'game one', 'utf-8');
      fs.writeFileSync(path.join(jobDir, 'game_003.txt'), 'game three', 'utf-8');
      const result = await logStore.getRawLogs(jobId);
      assert(result !== null, 'should not be null');
      assertEqual(result!.length, 3, 'should have 3 games');
      assertEqual(result![0], 'game one', 'first game');
      assertEqual(result![1], 'game two', 'second game');
      assertEqual(result![2], 'game three', 'third game');
    });

    await test('getRawLogs: ignores non-game files', async () => {
      const jobId = 'job-ignore-nongame';
      const jobDir = path.join(tempDir, jobId);
      fs.mkdirSync(jobDir, { recursive: true });
      fs.writeFileSync(path.join(jobDir, 'game_001.txt'), 'game one', 'utf-8');
      fs.writeFileSync(path.join(jobDir, 'meta.json'), '{}', 'utf-8');
      fs.writeFileSync(path.join(jobDir, 'readme.txt'), 'ignore me', 'utf-8');
      const result = await logStore.getRawLogs(jobId);
      assert(result !== null, 'should not be null');
      assertEqual(result!.length, 1, 'should have 1 game');
    });

    // =========================================================================
    // ingestLogs
    // =========================================================================

    await test('ingestLogs: returns correct gameCount', async () => {
      const result = await logStore.ingestLogs('job-ingest-1', games, ['A', 'B', 'C', 'D']);
      assertEqual(result.gameCount, 4, 'gameCount');
    });

    await test('ingestLogs: writes game_NNN.txt files', async () => {
      const jobId = 'job-ingest-files';
      await logStore.ingestLogs(jobId, games, ['A', 'B', 'C', 'D']);
      const jobDir = path.join(tempDir, jobId);
      for (let i = 1; i <= 4; i++) {
        const filename = `game_${String(i).padStart(3, '0')}.txt`;
        assert(fs.existsSync(path.join(jobDir, filename)), `${filename} should exist`);
      }
    });

    await test('ingestLogs: writes meta.json with condensed, structured, deckNames', async () => {
      const jobId = 'job-ingest-meta';
      await logStore.ingestLogs(jobId, games, ['A', 'B', 'C', 'D'], ['list-a', 'list-b', 'list-c', 'list-d']);
      const metaPath = path.join(tempDir, jobId, 'meta.json');
      assert(fs.existsSync(metaPath), 'meta.json should exist');
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      assert(Array.isArray(meta.condensed), 'meta should have condensed array');
      assert(Array.isArray(meta.structured), 'meta should have structured array');
      assertEqual(meta.condensed.length, 4, 'condensed length');
      assertEqual(meta.structured.length, 4, 'structured length');
      assert(Array.isArray(meta.deckNames), 'meta should have deckNames');
      assert(Array.isArray(meta.deckLists), 'meta should have deckLists');
    });

    await test('ingestLogs: handles concatenated logs (splits internally)', async () => {
      // Pass the raw log as a single element — ingestLogs should split it
      const result = await logStore.ingestLogs('job-ingest-concat', [rawLog], ['A', 'B', 'C', 'D']);
      assertEqual(result.gameCount, 4, 'should split into 4 games');
    });

    await test('ingestLogs: cleans old game files before re-ingesting', async () => {
      const jobId = 'job-ingest-clean';
      // First ingest: write 4 games
      await logStore.ingestLogs(jobId, games, ['A', 'B', 'C', 'D']);
      // Write an extra game file to simulate leftover from previous ingest
      fs.writeFileSync(path.join(tempDir, jobId, 'game_005.txt'), 'old', 'utf-8');
      // Re-ingest with only 4 games
      await logStore.ingestLogs(jobId, games, ['A', 'B', 'C', 'D']);
      const oldFile = path.join(tempDir, jobId, 'game_005.txt');
      assert(!fs.existsSync(oldFile), 'game_005.txt should be cleaned');
    });

    // =========================================================================
    // getCondensedLogs
    // =========================================================================

    await test('getCondensedLogs: returns null when no data exists', async () => {
      const result = await logStore.getCondensedLogs('nonexistent-condensed');
      assertEqual(result, null, 'should return null');
    });

    await test('getCondensedLogs: returns precomputed condensed from meta.json', async () => {
      const jobId = 'job-condensed-pre';
      await logStore.ingestLogs(jobId, games, ['A', 'B', 'C', 'D']);
      const result = await logStore.getCondensedLogs(jobId);
      assert(result !== null, 'should not be null');
      assertEqual(result!.length, 4, 'should have 4 condensed games');
      assert(result![0].turnCount > 0, 'first game should have turns');
    });

    await test('getCondensedLogs: recomputes from raw files when meta.json missing', async () => {
      const jobId = 'job-condensed-fallback';
      // Write raw game files directly without meta.json
      const jobDir = path.join(tempDir, jobId);
      fs.mkdirSync(jobDir, { recursive: true });
      games.forEach((g, i) => {
        fs.writeFileSync(path.join(jobDir, `game_${String(i + 1).padStart(3, '0')}.txt`), g, 'utf-8');
      });
      const result = await logStore.getCondensedLogs(jobId);
      assert(result !== null, 'should not be null (fallback)');
      assertEqual(result!.length, 4, 'should have 4 condensed games');
    });

    // =========================================================================
    // getStructuredLogs
    // =========================================================================

    await test('getStructuredLogs: returns null when no data exists', async () => {
      const result = await logStore.getStructuredLogs('nonexistent-structured');
      assertEqual(result, null, 'should return null');
    });

    await test('getStructuredLogs: returns { games, deckNames } from meta.json', async () => {
      const jobId = 'job-structured-pre';
      await logStore.ingestLogs(jobId, games, ['A', 'B', 'C', 'D']);
      const result = await logStore.getStructuredLogs(jobId);
      assert(result !== null, 'should not be null');
      assert(Array.isArray(result!.games), 'should have games array');
      assertEqual(result!.games.length, 4, 'should have 4 structured games');
      assert(Array.isArray(result!.deckNames), 'should have deckNames');
    });

    await test('getStructuredLogs: recomputes from raw files when meta.json missing', async () => {
      const jobId = 'job-structured-fallback';
      const jobDir = path.join(tempDir, jobId);
      fs.mkdirSync(jobDir, { recursive: true });
      games.forEach((g, i) => {
        fs.writeFileSync(path.join(jobDir, `game_${String(i + 1).padStart(3, '0')}.txt`), g, 'utf-8');
      });
      const result = await logStore.getStructuredLogs(jobId);
      assert(result !== null, 'should not be null (fallback)');
      assertEqual(result!.games.length, 4, 'should have 4 structured games');
    });

    await test('getStructuredLogs: deckNamesHint overrides stored deckNames in fallback', async () => {
      const jobId = 'job-structured-hint';
      const jobDir = path.join(tempDir, jobId);
      fs.mkdirSync(jobDir, { recursive: true });
      games.forEach((g, i) => {
        fs.writeFileSync(path.join(jobDir, `game_${String(i + 1).padStart(3, '0')}.txt`), g, 'utf-8');
      });
      const hint = ['X', 'Y', 'Z', 'W'];
      const result = await logStore.getStructuredLogs(jobId, hint);
      assert(result !== null, 'should not be null');
      assert(result!.deckNames !== undefined, 'deckNames should be present');
      assertEqual(result!.deckNames![0], 'X', 'hint should override');
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
