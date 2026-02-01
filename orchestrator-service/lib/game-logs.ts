/**
 * Game Log File Utilities
 *
 * Functions for discovering, sorting, and reading game log files produced by
 * the Forge simulation engine.
 *
 * File naming patterns:
 * - Single run: job_<jobId>_game_1.txt, job_<jobId>_game_2.txt, ...
 * - Batched runs: job_<jobId>_run0_game_1.txt, job_<jobId>_run1_game_1.txt, ...
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Parsed game log filename components.
 */
interface ParsedLogFilename {
  filename: string;
  runIndex: number;
  gameNumber: number;
}

/**
 * Parses a game log filename to extract run index and game number.
 *
 * Handles both patterns:
 * - job_<jobId>_game_N.txt -> runIndex: 0, gameNumber: N
 * - job_<jobId>_runM_game_N.txt -> runIndex: M, gameNumber: N
 *
 * @param filename - The filename to parse
 * @returns Parsed components, or null if filename doesn't match expected pattern
 */
export function parseLogFilename(filename: string): ParsedLogFilename | null {
  // Pattern for batched runs: job_<jobId>_run<M>_game_<N>.txt
  const batchedMatch = filename.match(/_run(\d+)_game_(\d+)\.txt$/);
  if (batchedMatch) {
    return {
      filename,
      runIndex: parseInt(batchedMatch[1], 10),
      gameNumber: parseInt(batchedMatch[2], 10),
    };
  }

  // Pattern for single runs: job_<jobId>_game_<N>.txt
  const singleMatch = filename.match(/_game_(\d+)\.txt$/);
  if (singleMatch) {
    return {
      filename,
      runIndex: 0,
      gameNumber: parseInt(singleMatch[1], 10),
    };
  }

  return null;
}

/**
 * Sorts game log filenames by (runIndex, gameNumber).
 *
 * This ensures deterministic ordering where all games from run 0 come first
 * (game 1, 2, 3...), then all games from run 1, etc.
 *
 * @param filenames - Array of filenames to sort
 * @returns Sorted array of filenames
 */
export function sortLogFilenames(filenames: string[]): string[] {
  const parsed = filenames
    .map((f) => parseLogFilename(f))
    .filter((p): p is ParsedLogFilename => p !== null);

  parsed.sort((a, b) => {
    if (a.runIndex !== b.runIndex) {
      return a.runIndex - b.runIndex;
    }
    return a.gameNumber - b.gameNumber;
  });

  return parsed.map((p) => p.filename);
}

/**
 * Finds all game log files for a job in the given directory.
 *
 * @param logsDir - Directory containing log files
 * @param jobId - The job ID to filter by
 * @returns Array of matching filenames (not full paths), sorted by (runIndex, gameNumber)
 */
export function findGameLogFiles(logsDir: string, jobId: string): string[] {
  const prefix = `job_${jobId}`;

  try {
    if (!fs.existsSync(logsDir)) {
      return [];
    }
    const files = fs.readdirSync(logsDir);
    const matchingFiles = files.filter(
      (f) => f.startsWith(prefix) && f.includes('_game_') && f.endsWith('.txt')
    );
    return sortLogFilenames(matchingFiles);
  } catch {
    return [];
  }
}

/**
 * Counts game log files for a job without reading their contents.
 * Used for progress tracking during simulation.
 *
 * @param logsDir - Directory containing log files
 * @param jobId - The job ID to filter by
 * @returns Number of matching game log files
 */
export function countGameLogFiles(logsDir: string, jobId: string): number {
  return findGameLogFiles(logsDir, jobId).length;
}

/**
 * Reads all game log files for a job.
 *
 * @param logsDir - Directory containing log files
 * @param jobId - The job ID to filter by
 * @returns Array of log contents, sorted by (runIndex, gameNumber)
 */
export function readGameLogs(logsDir: string, jobId: string): string[] {
  const logs: string[] = [];

  try {
    const logFiles = findGameLogFiles(logsDir, jobId);

    for (const file of logFiles) {
      const content = fs.readFileSync(path.join(logsDir, file), 'utf-8');
      if (content.trim()) {
        logs.push(content);
      }
    }
  } catch (error) {
    console.error(`[GameLogs] Error reading logs:`, error);
  }

  return logs;
}
