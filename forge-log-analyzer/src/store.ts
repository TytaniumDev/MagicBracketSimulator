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
import type { StoredJobLogs, CondensedGame, StructuredGame, AnalyzePayload, DeckOutcome, DeckInfo } from './types.js';
import { condenseGames, structureGames } from './condenser/index.js';

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

/**
 * Counts the number of game log files for a job without reading their content.
 * Assuming storeJobLogs has already split them into individual files.
 */
function countGameLogFiles(jobId: string): number {
  const jobDir = getJobDir(jobId);
  if (!fs.existsSync(jobDir)) {
    return 0;
  }
  const files = fs.readdirSync(jobDir);
  return files.filter((f) => /^game_\d+\.txt$/.test(f)).length;
}

/**
 * Retrieves stored metadata for a job (without reading raw logs).
 */
function getJobMeta(jobId: string): Omit<StoredJobLogs, 'gameLogs'> | null {
  const metaPath = getMetaFilePath(jobId);
  if (!fs.existsSync(metaPath)) {
    return null;
  }
  try {
    const metaContent = fs.readFileSync(metaPath, 'utf-8');
    return JSON.parse(metaContent);
  } catch (error) {
    console.error(`[Store] Error reading meta for job ${jobId}:`, error);
    return null;
  }
}

// -----------------------------------------------------------------------------
// Storage Operations
// -----------------------------------------------------------------------------

/**
 * Builds the slim analyze payload from condensed games and deck info.
 * 
 * This aggregates game outcomes (wins, winning turns, turns lost on) for each deck
 * instead of sending full condensed logs to Gemini.
 */
function buildAnalyzePayload(
  condensed: CondensedGame[],
  deckNames?: string[],
  deckLists?: string[]
): AnalyzePayload {
  // Build deck info array
  const decks: DeckInfo[] = (deckNames ?? []).map((name, i) => ({
    name,
    decklist: deckLists?.[i],
  }));

  // Initialize outcomes for all known decks
  const outcomes: Record<string, DeckOutcome> = {};
  for (const name of deckNames ?? []) {
    outcomes[name] = { wins: 0, winning_turns: [], turns_lost_on: [] };
  }

  // Aggregate outcomes from each game
  for (const game of condensed) {
    if (!game.winner) continue;

    // Match winner to deck name (winner might be "Ai(N)-DeckName" format)
    let matchedWinner = game.winner;
    if (deckNames) {
      const found = deckNames.find(
        (name) => game.winner === name || game.winner?.endsWith(`-${name}`)
      );
      if (found) {
        matchedWinner = found;
      }
    }

    // Ensure winner has an entry
    if (!outcomes[matchedWinner]) {
      outcomes[matchedWinner] = { wins: 0, winning_turns: [], turns_lost_on: [] };
    }

    // Record the win
    outcomes[matchedWinner].wins += 1;
    if (game.winningTurn !== undefined) {
      outcomes[matchedWinner].winning_turns.push(game.winningTurn);
    }

    // For all other decks, this is a loss - record the turn they lost on
    if (game.winningTurn !== undefined) {
      for (const name of deckNames ?? []) {
        if (name !== matchedWinner) {
          if (!outcomes[name]) {
            outcomes[name] = { wins: 0, winning_turns: [], turns_lost_on: [] };
          }
          outcomes[name].turns_lost_on.push(game.winningTurn);
        }
      }
    }
  }

  // Sort turn arrays for consistent output
  for (const outcome of Object.values(outcomes)) {
    outcome.winning_turns.sort((a, b) => a - b);
    outcome.turns_lost_on.sort((a, b) => a - b);
  }

  return {
    decks,
    total_games: condensed.length,
    outcomes,
  };
}

/**
 * Stores raw game logs for a job.
 *
 * Writes each game as a plain-text file (game_001.txt, game_002.txt, ...)
 * and metadata to meta.json.
 *
 * @param jobId - The unique job identifier
 * @param gameLogs - Array of raw game log strings
 * @param deckNames - Optional deck names (all 4 decks)
 * @param deckLists - Optional deck lists (.dck content) for all 4 decks
 */
export function storeJobLogs(
  jobId: string,
  gameLogs: string[],
  deckNames?: string[],
  deckLists?: string[]
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

  // Expand concatenated games: each incoming item may contain multiple games (e.g. one file per run with many games)
  const expandedLogs = gameLogs.flatMap(splitConcatenatedGames);

  // Write each game as raw text (one file per actual game)
  expandedLogs.forEach((log, i) => {
    const filename = `game_${String(i + 1).padStart(3, '0')}.txt`;
    fs.writeFileSync(path.join(jobDir, filename), log, 'utf-8');
  });

  // Pre-compute condensed logs from expanded games
  const condensed = condenseGames(expandedLogs);
  
  // Pre-compute structured logs from expanded games
  const structured = structureGames(expandedLogs, deckNames);
  
  // Pre-compute the slim analyze payload (decks + outcomes; total_games = expanded count)
  const analyzePayload = buildAnalyzePayload(condensed, deckNames, deckLists);

  // Write metadata with all pre-computed data
  const meta = {
    deckNames,
    deckLists,
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
 *
 * @deprecated Use getJobMeta for metadata only, or getRawLogs for full logs.
 */
export function getJobLogs(jobId: string): StoredJobLogs | null {
  const meta = getJobMeta(jobId);
  if (!meta) {
    return null;
  }

  // Read raw logs
  const jobDir = getJobDir(jobId);
  const gameLogs = readGameLogFiles(jobDir);
  if (gameLogs.length === 0) {
    return null;
  }

  return {
    ...meta,
    gameLogs,
  };
}

/**
 * Writes metadata (and cached condensed/structured) to meta.json.
 */
function writeMeta(
  jobId: string,
  meta: Omit<StoredJobLogs, 'gameLogs'>
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
  const meta = getJobMeta(jobId);
  if (!meta) {
    return null;
  }

  // Verify consistency with file count (fast check)
  const fileCount = countGameLogFiles(jobId);
  if (fileCount === 0) {
    return null;
  }

  // Check if already computed and game count matches
  if (meta.condensed && meta.condensed.length === fileCount) {
    return meta.condensed;
  }

  // Need raw logs to compute
  const rawLogs = getRawLogs(jobId);
  if (!rawLogs) return null;

  // Compute condensed logs
  const condensed = condenseGames(rawLogs);

  // Cache in meta.json
  const newMeta = { ...meta, condensed };
  writeMeta(jobId, newMeta);

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
  const meta = getJobMeta(jobId);
  if (!meta) {
    return null;
  }

  // Verify consistency with file count (fast check)
  const fileCount = countGameLogFiles(jobId);
  if (fileCount === 0) {
    return null;
  }

  // Check if already computed and valid
  if (meta.structured && meta.structured.length === fileCount) {
    // Basic validation of cached structure (check one sample if possible, or trust length match)
    // Detailed validation would require reading logs, defeating the optimization purpose.
    // We assume length match is sufficient for cache validity here.
    const invalid = meta.structured.some((g) => !g.lifePerTurn || (g.winner && g.winningTurn === undefined));
    if (!invalid) {
      return meta.structured;
    }
  }

  // Need raw logs to compute
  const rawLogs = getRawLogs(jobId);
  if (!rawLogs) return null;

  // Compute structured logs
  const structured = structureGames(rawLogs, meta.deckNames);

  // Cache in meta.json
  const newMeta = { ...meta, structured };
  writeMeta(jobId, newMeta);

  return structured;
}

/**
 * Gets the deck names for a job.
 *
 * @param jobId - The unique job identifier
 * @returns Array of deck names, or undefined if not set
 */
export function getDeckNames(jobId: string): string[] | undefined {
  const meta = getJobMeta(jobId);
  return meta?.deckNames;
}

/**
 * Gets the pre-computed analyze payload for a job.
 *
 * This returns the exact payload that will be sent to the Analysis Service (Gemini).
 * If the payload is in the old format or missing, it rebuilds it using the new slim format.
 *
 * @param jobId - The unique job identifier
 * @returns The analyze payload, or null if job not found or payload not pre-computed
 */
export function getAnalyzePayload(jobId: string): AnalyzePayload | null {
  const meta = getJobMeta(jobId);
  if (!meta) {
    return null;
  }

  // Check if we have a valid new-format payload (has 'decks' and 'outcomes')
  const payload = meta.analyzePayload;
  if (payload && 'decks' in payload && 'outcomes' in payload) {
    return payload;
  }

  // Need condensed logs to build payload.
  // Use getCondensedLogs() which handles lazy loading/computing of condensed logs.
  const condensed = getCondensedLogs(jobId);
  if (condensed && meta.deckNames) {
    const analyzePayload = buildAnalyzePayload(condensed, meta.deckNames, meta.deckLists);

    // Cache the payload - refetch meta to be safe
    const currentMeta = getJobMeta(jobId);
    if (currentMeta) {
      const newMeta = { ...currentMeta, analyzePayload };
      writeMeta(jobId, newMeta);
    }

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
  const metaPath = getMetaFilePath(jobId);
  return fs.existsSync(metaPath) && countGameLogFiles(jobId) > 0;
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
  const meta = getJobMeta(jobId);
  if (!meta) {
    return;
  }

  // Remove cached data
  const newMeta = { ...meta };
  delete newMeta.condensed;
  delete newMeta.structured;
  writeMeta(jobId, newMeta);
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
        return fs.existsSync(metaPath) && countGameLogFiles(e.name) > 0;
      })
      .map((e) => e.name);
  } catch (error) {
    console.error('[Store] Error listing jobs:', error);
    return [];
  }
}
