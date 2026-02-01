/**
 * =============================================================================
 * Forge Log Analyzer - Storage Layer
 * =============================================================================
 *
 * Simple file-based storage for job logs.
 *
 * Raw logs are stored as plain text files for debugging Forge and this app:
 *   - game_001.txt, game_002.txt, ... (one per game, raw text)
 *   - meta.json: deckNames, ingestedAt, condensed?, structured?
 *
 * =============================================================================
 */

import * as fs from 'fs';
import * as path from 'path';
import type { StoredJobLogs, CondensedGame, StructuredGame, AnalyzePayload } from './types.js';
import { condenseGames, structureGames, toAnalysisServiceFormatBatch } from './condenser/index.js';

// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// -----------------------------------------------------------------------------
// Path Helpers
// -----------------------------------------------------------------------------

/**
 * Gets the directory path for a job's data.
 */
function getJobDir(jobId: string): string {
  // Sanitize jobId to prevent directory traversal
  const sanitized = jobId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(DATA_DIR, sanitized);
}

/**
 * Path to meta.json (deckNames, ingestedAt, cached condensed/structured).
 */
function getMetaFilePath(jobId: string): string {
  return path.join(getJobDir(jobId), 'meta.json');
}

/**
 * Splits a raw log that may contain multiple concatenated games into one string per game.
 *
 * When 4 parallel Docker runs each write one file (run_sim.sh fallback), each file
 * contains 3 games concatenated. Each game ends with "Game Result: Game N ended ...".
 * We split on that so we don't over-split on "Turn: Turn 1" (which appears 4 times per game).
 */
function splitConcatenatedGames(rawLog: string): string[] {
  const trimmed = rawLog.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!trimmed) {
    return [];
  }

  // Split keeping the "Game Result: Game N ended ..." line with the game it ends
  const gameEndPattern = /(Game Result: Game \d+ ended[^\n]*\n?)/;
  const parts = trimmed.split(gameEndPattern);

  // parts: [preamble+game1, "Game Result: Game 1...", game2, "Game Result: Game 2...", game3, "Game Result: Game 3...", rest]
  if (parts.length < 2) {
    return [trimmed]; // single game, no "Game Result" found
  }

  const games: string[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const content = (parts[i] + parts[i + 1]).trim();
    if (content.length === 0) continue;
    // First game may include preamble (Simulation mode, etc.). Drop everything before first "Turn: Turn 1 (Ai(".
    const firstTurn = content.indexOf('Turn: Turn 1 (Ai(');
    if (firstTurn >= 0) {
      games.push(content.slice(firstTurn).trim());
    } else {
      games.push(content);
    }
  }

  return games.length > 0 ? games : [trimmed];
}

/**
 * Reads game logs from raw text files (game_001.txt, game_002.txt, ...).
 * Expands any file that contains multiple concatenated games into separate games.
 */
function readGameLogFiles(jobDir: string): string[] {
  if (!fs.existsSync(jobDir)) {
    return [];
  }
  const files = fs.readdirSync(jobDir);
  const gameFiles = files
    .filter((f) => /^game_\d+\.txt$/.test(f))
    .sort((a, b) => {
      const nA = parseInt(a.match(/\d+/)?.[0] ?? '0', 10);
      const nB = parseInt(b.match(/\d+/)?.[0] ?? '0', 10);
      return nA - nB;
    });
  const blobs = gameFiles.map((f) => fs.readFileSync(path.join(jobDir, f), 'utf-8'));
  return blobs.flatMap(splitConcatenatedGames);
}

// -----------------------------------------------------------------------------
// Storage Operations
// -----------------------------------------------------------------------------

/**
 * Stores raw game logs for a job.
 *
 * Writes each game as a plain-text file (game_001.txt, game_002.txt, ...)
 * and metadata to meta.json.
 *
 * @param jobId - The unique job identifier
 * @param gameLogs - Array of raw game log strings
 * @param deckNames - Optional deck names [hero, opp1, opp2, opp3]
 */
export function storeJobLogs(
  jobId: string,
  gameLogs: string[],
  deckNames?: string[]
): void {
  const jobDir = getJobDir(jobId);

  // Create job directory if it doesn't exist
  if (!fs.existsSync(jobDir)) {
    fs.mkdirSync(jobDir, { recursive: true });
  }

  // Remove any existing game_*.txt so re-ingest reflects exactly the new set
  if (fs.existsSync(jobDir)) {
    const existing = fs.readdirSync(jobDir);
    for (const f of existing) {
      if (/^game_\d+\.txt$/.test(f)) {
        fs.unlinkSync(path.join(jobDir, f));
      }
    }
  }

  // Write each game as raw text
  gameLogs.forEach((log, i) => {
    const filename = `game_${String(i + 1).padStart(3, '0')}.txt`;
    fs.writeFileSync(path.join(jobDir, filename), log, 'utf-8');
  });

  // Pre-compute condensed logs immediately
  const condensed = condenseGames(gameLogs);
  
  // Pre-compute structured logs immediately
  const structured = structureGames(gameLogs, deckNames);
  
  // Pre-compute the analyze payload (snake_case format for Analysis Service)
  const condensedForPython = toAnalysisServiceFormatBatch(condensed);
  const heroDeckName = deckNames?.[0] ?? 'Unknown Deck';
  const opponentDecks = deckNames?.slice(1) ?? [];
  const analyzePayload: AnalyzePayload = {
    hero_deck_name: heroDeckName,
    opponent_decks: opponentDecks,
    condensed_logs: condensedForPython,
  };

  // Write metadata with all pre-computed data
  const meta = {
    deckNames,
    ingestedAt: new Date().toISOString(),
    condensed,
    structured,
    analyzePayload,
  };
  fs.writeFileSync(getMetaFilePath(jobId), JSON.stringify(meta, null, 2), 'utf-8');
}

/**
 * Retrieves stored logs for a job.
 *
 * Reads from raw text files + meta.json.
 */
export function getJobLogs(jobId: string): StoredJobLogs | null {
  const jobDir = getJobDir(jobId);
  const metaPath = getMetaFilePath(jobId);

  if (!fs.existsSync(metaPath)) {
    return null;
  }

  try {
    const metaContent = fs.readFileSync(metaPath, 'utf-8');
    const meta = JSON.parse(metaContent) as {
      deckNames?: string[];
      ingestedAt: string;
      condensed?: CondensedGame[];
      structured?: StructuredGame[];
      analyzePayload?: AnalyzePayload;
    };
    const gameLogs = readGameLogFiles(jobDir);
    if (gameLogs.length === 0) {
      return null;
    }
    return {
      gameLogs,
      deckNames: meta.deckNames,
      ingestedAt: meta.ingestedAt,
      condensed: meta.condensed,
      structured: meta.structured,
      analyzePayload: meta.analyzePayload,
    };
  } catch (error) {
    console.error(`[Store] Error reading meta for job ${jobId}:`, error);
    return null;
  }
}

/**
 * Writes metadata (and cached condensed/structured) to meta.json.
 */
function writeMeta(
  jobId: string,
  meta: {
    deckNames?: string[];
    ingestedAt: string;
    condensed?: CondensedGame[];
    structured?: StructuredGame[];
    analyzePayload?: AnalyzePayload;
  }
): void {
  fs.writeFileSync(getMetaFilePath(jobId), JSON.stringify(meta, null, 2), 'utf-8');
}

/**
 * Gets raw game logs for a job.
 *
 * @param jobId - The unique job identifier
 * @returns Array of raw log strings, or null if not found
 */
export function getRawLogs(jobId: string): string[] | null {
  const data = getJobLogs(jobId);
  return data?.gameLogs ?? null;
}

/**
 * Gets condensed game logs for a job.
 *
 * If condensed logs haven't been computed yet, this will compute and
 * cache them in meta.json.
 *
 * @param jobId - The unique job identifier
 * @returns Array of condensed games, or null if job not found
 */
export function getCondensedLogs(jobId: string): CondensedGame[] | null {
  const data = getJobLogs(jobId);
  if (!data) {
    return null;
  }

  // Check if already computed and game count matches (e.g. after splitting concatenated games)
  if (data.condensed && data.condensed.length === data.gameLogs.length) {
    return data.condensed;
  }

  // Compute condensed logs
  const condensed = condenseGames(data.gameLogs);

  // Cache in meta.json
  const meta = JSON.parse(fs.readFileSync(getMetaFilePath(jobId), 'utf-8'));
  meta.condensed = condensed;
  writeMeta(jobId, meta);

  return condensed;
}

/**
 * Gets structured game logs for a job.
 *
 * If structured logs haven't been computed yet, this will compute and
 * cache them in meta.json.
 *
 * @param jobId - The unique job identifier
 * @returns Array of structured games, or null if job not found
 */
export function getStructuredLogs(jobId: string): StructuredGame[] | null {
  const data = getJobLogs(jobId);
  if (!data) {
    return null;
  }

  // Check if already computed and valid (avoid serving bad cache from old parsing bugs)
  if (data.structured) {
    const invalid = data.structured.some(
      (game, i) =>
        game.totalTurns === 0 &&
        game.players.length === 0 &&
        data.gameLogs[i]?.includes('Turn: Turn')
    );
    // Also invalidate if lifePerTurn is missing (added in a later version)
    const missingLifePerTurn = data.structured.some((g) => !g.lifePerTurn);
    // Invalidate if winningTurn is missing (added for round-based turns)
    const missingWinningTurn = data.structured.some((g) => g.winner && g.winningTurn === undefined);
    // Invalidate if game count changed (e.g. after splitting concatenated games)
    const countMismatch = data.structured.length !== data.gameLogs.length;
    if (!invalid && !missingLifePerTurn && !missingWinningTurn && !countMismatch) {
      return data.structured;
    }
    // Invalid or outdated cache; recompute
    const meta = JSON.parse(fs.readFileSync(getMetaFilePath(jobId), 'utf-8'));
    delete meta.structured;
    writeMeta(jobId, meta);
  }

  // Compute structured logs
  const structured = structureGames(data.gameLogs, data.deckNames);

  // Cache in meta.json
  const meta = JSON.parse(fs.readFileSync(getMetaFilePath(jobId), 'utf-8'));
  meta.structured = structured;
  writeMeta(jobId, meta);

  return structured;
}

/**
 * Gets the deck names for a job.
 *
 * @param jobId - The unique job identifier
 * @returns Array of deck names, or undefined if not set
 */
export function getDeckNames(jobId: string): string[] | undefined {
  const data = getJobLogs(jobId);
  return data?.deckNames;
}

/**
 * Gets the pre-computed analyze payload for a job.
 *
 * This returns the exact payload that will be sent to the Analysis Service (Gemini).
 * It reads only from cache - no computation is performed.
 *
 * @param jobId - The unique job identifier
 * @returns The analyze payload, or null if job not found or payload not pre-computed
 */
export function getAnalyzePayload(jobId: string): AnalyzePayload | null {
  const data = getJobLogs(jobId);
  if (!data) {
    return null;
  }

  // Return pre-computed payload if available
  if (data.analyzePayload) {
    return data.analyzePayload;
  }

  // For backward compatibility: compute payload for jobs that were ingested before this feature
  if (data.condensed && data.deckNames) {
    const condensedForPython = toAnalysisServiceFormatBatch(data.condensed);
    const heroDeckName = data.deckNames[0] ?? 'Unknown Deck';
    const opponentDecks = data.deckNames.slice(1);
    const analyzePayload: AnalyzePayload = {
      hero_deck_name: heroDeckName,
      opponent_decks: opponentDecks,
      condensed_logs: condensedForPython,
    };

    // Cache the payload
    const meta = JSON.parse(fs.readFileSync(getMetaFilePath(jobId), 'utf-8'));
    meta.analyzePayload = analyzePayload;
    writeMeta(jobId, meta);

    return analyzePayload;
  }

  return null;
}

/**
 * Checks if logs exist for a job.
 *
 * @param jobId - The unique job identifier
 * @returns true if logs exist
 */
export function hasJobLogs(jobId: string): boolean {
  const jobDir = getJobDir(jobId);
  const metaPath = getMetaFilePath(jobId);
  return fs.existsSync(metaPath) && readGameLogFiles(jobDir).length > 0;
}

/**
 * Deletes logs for a job.
 *
 * @param jobId - The unique job identifier
 * @returns true if deleted, false if not found
 */
export function deleteJobLogs(jobId: string): boolean {
  const jobDir = getJobDir(jobId);

  if (!fs.existsSync(jobDir)) {
    return false;
  }

  try {
    fs.rmSync(jobDir, { recursive: true, force: true });
    return true;
  } catch (error) {
    console.error(`[Store] Error deleting logs for job ${jobId}:`, error);
    return false;
  }
}

/**
 * Invalidates cached condensed/structured data for a job.
 *
 * Useful if the condensing logic changes and you want to recompute.
 *
 * @param jobId - The unique job identifier
 */
export function invalidateCache(jobId: string): void {
  const data = getJobLogs(jobId);
  if (!data) {
    return;
  }

  // Remove cached data
  const meta = JSON.parse(fs.readFileSync(getMetaFilePath(jobId), 'utf-8'));
  delete meta.condensed;
  delete meta.structured;
  writeMeta(jobId, meta);
}

/**
 * Lists all job IDs that have stored logs.
 *
 * @returns Array of job IDs
 */
export function listJobs(): string[] {
  if (!fs.existsSync(DATA_DIR)) {
    return [];
  }

  try {
    const entries = fs.readdirSync(DATA_DIR, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .filter((e) => {
        const metaPath = path.join(DATA_DIR, e.name, 'meta.json');
        return fs.existsSync(metaPath) && readGameLogFiles(path.join(DATA_DIR, e.name)).length > 0;
      })
      .map((e) => e.name);
  } catch (error) {
    console.error('[Store] Error listing jobs:', error);
    return [];
  }
}
