/**
 * Log storage abstraction — local filesystem or GCS depending on mode.
 *
 * LOCAL mode: stores logs as files under `logs-data/{jobId}/`
 * GCP mode: stores logs in Cloud Storage via gcs-storage.ts (gzipped)
 *
 * Raw logs are kept as the worker uploaded them: one file per simulation,
 * each holding up to GAMES_PER_CONTAINER games (older jobs hold one game per
 * file). They are kept forever. Aggregation adds one small file next to
 * them, `games.json`: the game index, which says where each game's log is
 * and who won it. Card stats add `card-stats.json`, what the job added to
 * each deck's card counters, so deleting the job can take it back. Condensed and structured views of a game are built from
 * its raw log when someone asks for that game.
 *
 * Every reader here holds at most a few raw log files at a time, so a
 * 1000-game job fits in the API's memory.
 */

import * as fs from 'fs';
import * as path from 'path';
import { isGcpMode } from './env';
import * as gcs from './gcs-storage';
import { condenseGame, structureGame, splitConcatenatedGames } from './condenser/index';
import type { GameLogResponse, GameSummary } from './types';
import * as Sentry from '@sentry/nextjs';

// Local filesystem storage directory
const LOGS_DATA_DIR = process.env.LOGS_DATA_DIR ?? path.join(process.cwd(), 'logs-data');

/**
 * Max bytes for a single simulation log upload. Forge logs for a full game
 * are typically <500 KB; 10 MB gives ~20x headroom and caps runaway / malicious
 * uploads before they can OOM the API or balloon GCS costs.
 */
export const MAX_LOG_BYTES = 10 * 1024 * 1024;

/** The game index's file name, next to the raw logs. */
const GAME_INDEX_FILE = 'games.json';

/** Raw log files read at once while walking a job's games (GCS round trips overlap). */
const RAW_READ_BATCH = 8;

// Ensure local data directory exists in LOCAL mode
if (!isGcpMode() && !fs.existsSync(LOGS_DATA_DIR)) {
  fs.mkdirSync(LOGS_DATA_DIR, { recursive: true });
}

function getJobDir(jobId: string): string {
  const sanitized = jobId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(LOGS_DATA_DIR, sanitized);
}

/** One game of a job: where its raw log is, and its outcome. */
export interface GameIndexEntry extends GameSummary {
  /** The raw log file holding the game, as `listRawLogFiles` names it. */
  file: string;
  /** The game's position among that file's games. */
  index: number;
}

/** Every game of a job, in play order. */
export interface GameIndex {
  deckNames?: string[];
  games: GameIndexEntry[];
}

// ─── Single simulation log upload (incremental) ──────────────────────────────

/**
 * Upload a single simulation's raw log. Called incrementally by the worker
 * after each simulation completes, so logs are preserved even if the job fails.
 */
export async function uploadSingleSimulationLog(
  jobId: string,
  filename: string,
  logText: string
): Promise<void> {
  const byteLength = Buffer.byteLength(logText, 'utf-8');
  if (byteLength > MAX_LOG_BYTES) {
    throw new Error(
      `Log too large: ${byteLength} bytes exceeds max of ${MAX_LOG_BYTES} bytes`
    );
  }

  if (isGcpMode()) {
    await gcs.uploadJobArtifact(jobId, filename, logText);
  } else {
    const jobDir = getJobDir(jobId);
    if (!fs.existsSync(jobDir)) {
      fs.mkdirSync(jobDir, { recursive: true });
    }
    // filename is like "raw/game_001.txt" — strip the "raw/" prefix for local storage
    const localFilename = filename.replace(/^raw\//, '');
    fs.writeFileSync(path.join(jobDir, localFilename), logText, 'utf-8');
  }
}

// ─── Raw logs ────────────────────────────────────────────────────────────────

/** A job's raw log files, in play order. Empty when it has none. */
async function listRawLogFiles(jobId: string): Promise<string[]> {
  if (isGcpMode()) {
    const artifacts = await gcs.listJobArtifacts(jobId);
    return artifacts.filter((f) => f.startsWith('raw/') && f.endsWith('.txt')).sort();
  }
  const jobDir = getJobDir(jobId);
  if (!fs.existsSync(jobDir)) return [];
  return fs.readdirSync(jobDir).filter((f) => /^game_\d+\.txt$/.test(f)).sort();
}

/** One raw log file's text, or null when it is missing. */
async function readRawLogFile(jobId: string, file: string): Promise<string | null> {
  if (isGcpMode()) return gcs.getJobArtifact(jobId, file);
  const filePath = path.join(getJobDir(jobId), file);
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : null;
}

/**
 * Visit every game of a job in play order, a few raw log files at a time, so
 * the job's logs are never all in memory at once. Returns how many games it
 * visited.
 */
export async function forEachRawGame(
  jobId: string,
  visit: (game: string, file: string, index: number) => void
): Promise<number> {
  const files = await listRawLogFiles(jobId);
  let count = 0;
  for (let start = 0; start < files.length; start += RAW_READ_BATCH) {
    const batch = files.slice(start, start + RAW_READ_BATCH);
    const texts = await Promise.all(batch.map((file) => readRawLogFile(jobId, file)));
    for (const [i, text] of texts.entries()) {
      if (text === null) continue;
      splitConcatenatedGames(text).forEach((game, index) => {
        visit(game, batch[i]!, index);
        count++;
      });
      // Parsing a file's games takes a while; let other requests run between files.
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
  return count;
}

// ─── Small JSON files next to the raw logs ───────────────────────────────────

/** Store a small JSON file next to a job's raw logs (gzipped in GCS). */
export async function saveJobJson(jobId: string, file: string, data: unknown): Promise<void> {
  const json = JSON.stringify(data);
  if (isGcpMode()) {
    await gcs.uploadJobArtifact(jobId, file, json);
    return;
  }
  fs.mkdirSync(getJobDir(jobId), { recursive: true });
  fs.writeFileSync(path.join(getJobDir(jobId), file), json, 'utf-8');
}

/** A file saved with saveJobJson, or null when it is missing or unreadable (reported to Sentry). */
export async function readJobJson<T>(jobId: string, file: string): Promise<T | null> {
  try {
    if (isGcpMode()) return await gcs.getJobArtifactJson<T>(jobId, file);
    const filePath = path.join(getJobDir(jobId), file);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch (err) {
    Sentry.captureException(err, { tags: { component: 'log-store', jobId }, extra: { file } });
    return null;
  }
}

// ─── Game index ──────────────────────────────────────────────────────────────

/**
 * Build a job's game index from its raw logs. `visit` sees each game's raw
 * log on the way, so a caller can take what else it needs in the same pass.
 * Returns null when the job has no logs.
 */
export async function buildGameIndex(
  jobId: string,
  deckNames?: string[],
  visit?: (game: string) => void
): Promise<GameIndex | null> {
  const games: GameIndexEntry[] = [];
  await forEachRawGame(jobId, (game, file, index) => {
    const { winner, winningTurn } = structureGame(game, deckNames);
    const entry: GameIndexEntry = { file, index };
    if (winner !== undefined) entry.winner = winner;
    if (winningTurn !== undefined) entry.winningTurn = winningTurn;
    games.push(entry);
    visit?.(game);
  });
  return games.length > 0 ? { deckNames, games } : null;
}

/** Store a job's game index next to its raw logs. */
export async function saveGameIndex(jobId: string, gameIndex: GameIndex): Promise<void> {
  await saveJobJson(jobId, GAME_INDEX_FILE, gameIndex);
}

/**
 * A job's game index: the stored one, or one built from the raw logs when
 * the job was never aggregated (a FAILED job, say). Null when it has no logs.
 */
export async function getGameIndex(jobId: string, deckNamesHint?: string[]): Promise<GameIndex | null> {
  return (await readJobJson<GameIndex>(jobId, GAME_INDEX_FILE)) ?? buildGameIndex(jobId, deckNamesHint);
}

/**
 * One game's raw log with its condensed and structured views, built on
 * request. `n` counts from 0 in play order. Null when there is no such game.
 */
export async function getGameLog(
  jobId: string,
  n: number,
  deckNamesHint?: string[]
): Promise<GameLogResponse | null> {
  const gameIndex = await getGameIndex(jobId, deckNamesHint);
  const entry = gameIndex?.games.at(n);
  if (!gameIndex || !entry || n < 0) return null;

  const text = await readRawLogFile(jobId, entry.file);
  const raw = text === null ? undefined : splitConcatenatedGames(text).at(entry.index);
  if (raw === undefined) return null;

  return {
    raw,
    condensed: condenseGame(raw),
    structured: structureGame(raw, gameIndex.deckNames ?? deckNamesHint),
  };
}

/**
 * Delete every stored log for a job (raw, condensed, structured).
 */
export async function deleteLogs(jobId: string): Promise<void> {
  if (isGcpMode()) {
    await gcs.deleteJobArtifacts(jobId);
    return;
  }
  fs.rmSync(getJobDir(jobId), { recursive: true, force: true });
}
