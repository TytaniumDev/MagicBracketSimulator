/**
 * Log storage abstraction — local filesystem or GCS depending on mode.
 *
 * LOCAL mode: stores logs as files under `logs-data/{jobId}/`
 * GCP mode: stores logs in Cloud Storage via gcs-storage.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { isGcpMode } from './job-store-factory';
import * as gcs from './gcs-storage';
import { condenseGames, structureGames, splitConcatenatedGames } from './condenser/index';
import type { CondensedGame, StructuredGame } from './types';
import type { AnalyzePayload } from './gemini';

// Local filesystem storage directory
const LOGS_DATA_DIR = process.env.LOGS_DATA_DIR ?? path.join(process.cwd(), 'logs-data');

// Ensure local data directory exists in LOCAL mode
if (!isGcpMode() && !fs.existsSync(LOGS_DATA_DIR)) {
  fs.mkdirSync(LOGS_DATA_DIR, { recursive: true });
}

function getJobDir(jobId: string): string {
  const sanitized = jobId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(LOGS_DATA_DIR, sanitized);
}

function getMetaPath(jobId: string): string {
  return path.join(getJobDir(jobId), 'meta.json');
}

export type { AnalyzePayload };

interface StoredMeta {
  deckNames?: string[];
  deckLists?: string[];
  ingestedAt: string;
  condensed?: CondensedGame[];
  structured?: StructuredGame[];
  analyzePayload?: AnalyzePayload;
}

// ─── Ingest (POST) ──────────────────────────────────────────────────────────

function buildAnalyzePayload(
  condensed: CondensedGame[],
  deckNames?: string[],
  deckLists?: string[]
): AnalyzePayload {
  const decks = (deckNames ?? []).map((name, i) => ({
    name,
    decklist: deckLists?.[i] ?? '',
  }));

  const outcomes: AnalyzePayload['outcomes'] = {};
  for (const name of deckNames ?? []) {
    outcomes[name] = { wins: 0, winning_turns: [], turns_lost_on: [] };
  }

  for (const game of condensed) {
    if (!game.winner) continue;
    let matchedWinner = game.winner;
    if (deckNames) {
      const found = deckNames.find(
        (name) => game.winner === name || game.winner?.endsWith(`-${name}`)
      );
      if (found) matchedWinner = found;
    }
    if (!outcomes[matchedWinner]) {
      outcomes[matchedWinner] = { wins: 0, winning_turns: [], turns_lost_on: [] };
    }
    outcomes[matchedWinner].wins += 1;
    if (game.winningTurn !== undefined) {
      outcomes[matchedWinner].winning_turns.push(game.winningTurn);
    }
    if (game.winningTurn !== undefined) {
      for (const name of deckNames ?? []) {
        if (name !== matchedWinner) {
          if (!outcomes[name]) outcomes[name] = { wins: 0, winning_turns: [], turns_lost_on: [] };
          outcomes[name].turns_lost_on.push(game.winningTurn);
        }
      }
    }
  }

  for (const outcome of Object.values(outcomes)) {
    outcome.winning_turns.sort((a, b) => a - b);
    outcome.turns_lost_on.sort((a, b) => a - b);
  }

  return { decks, total_games: condensed.length, outcomes };
}

/**
 * Ingest raw game logs for a job. Pre-computes condensed, structured, and analyze payload.
 */
export async function ingestLogs(
  jobId: string,
  gameLogs: string[],
  deckNames?: string[],
  deckLists?: string[]
): Promise<{ gameCount: number }> {
  const expandedLogs = gameLogs.flatMap(splitConcatenatedGames);
  const condensed = condenseGames(expandedLogs);
  const structured = structureGames(expandedLogs, deckNames);
  const analyzePayload = buildAnalyzePayload(condensed, deckNames, deckLists);

  if (isGcpMode()) {
    // Upload raw logs
    await gcs.uploadRawLogs(jobId, expandedLogs);
    // Upload pre-computed JSON
    await gcs.uploadJobArtifact(jobId, 'condensed.json', JSON.stringify(condensed));
    await gcs.uploadJobArtifact(jobId, 'structured.json', JSON.stringify({ games: structured, deckNames }));
    await gcs.uploadJobArtifact(jobId, 'analyze-payload.json', JSON.stringify(analyzePayload));
  } else {
    // Local filesystem
    const jobDir = getJobDir(jobId);
    if (fs.existsSync(jobDir)) {
      // Clean old game files
      for (const f of fs.readdirSync(jobDir)) {
        if (/^game_\d+\.txt$/.test(f)) fs.unlinkSync(path.join(jobDir, f));
      }
    } else {
      fs.mkdirSync(jobDir, { recursive: true });
    }

    // Write raw game files
    expandedLogs.forEach((log, i) => {
      const filename = `game_${String(i + 1).padStart(3, '0')}.txt`;
      fs.writeFileSync(path.join(jobDir, filename), log, 'utf-8');
    });

    // Write metadata with pre-computed data
    const meta: StoredMeta = {
      deckNames,
      deckLists,
      ingestedAt: new Date().toISOString(),
      condensed,
      structured,
      analyzePayload,
    };
    fs.writeFileSync(getMetaPath(jobId), JSON.stringify(meta, null, 2), 'utf-8');
  }

  return { gameCount: expandedLogs.length };
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

// ─── Read helpers (GET) ──────────────────────────────────────────────────────

function readLocalMeta(jobId: string): StoredMeta | null {
  const metaPath = getMetaPath(jobId);
  if (!fs.existsSync(metaPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as StoredMeta;
  } catch {
    return null;
  }
}

function readLocalRawLogs(jobId: string): string[] | null {
  const jobDir = getJobDir(jobId);
  if (!fs.existsSync(jobDir)) return null;
  const files = fs.readdirSync(jobDir)
    .filter((f) => /^game_\d+\.txt$/.test(f))
    .sort();
  if (files.length === 0) return null;
  return files.map((f) => fs.readFileSync(path.join(jobDir, f), 'utf-8'));
}

export async function getRawLogs(jobId: string): Promise<string[] | null> {
  if (isGcpMode()) {
    const logs = await gcs.getRawLogs(jobId);
    return logs.length > 0 ? logs : null;
  }
  return readLocalRawLogs(jobId);
}

export async function getCondensedLogs(jobId: string): Promise<CondensedGame[] | null> {
  if (isGcpMode()) {
    const precomputed = await gcs.getJobArtifactJson<CondensedGame[]>(jobId, 'condensed.json');
    if (precomputed) return precomputed;
    // Fallback: compute from raw logs (e.g. FAILED jobs where bulk upload never happened)
    const raw = await gcs.getRawLogs(jobId);
    if (raw.length === 0) return null;
    return condenseGames(raw);
  }
  const meta = readLocalMeta(jobId);
  if (meta?.condensed) return meta.condensed;
  // Fallback: compute from raw logs
  const raw = readLocalRawLogs(jobId);
  if (!raw) return null;
  return condenseGames(raw);
}

export async function getStructuredLogs(
  jobId: string,
  deckNamesHint?: string[]
): Promise<{ games: StructuredGame[]; deckNames?: string[] } | null> {
  if (isGcpMode()) {
    const precomputed = await gcs.getJobArtifactJson<{ games: StructuredGame[]; deckNames?: string[] }>(
      jobId,
      'structured.json'
    );
    if (precomputed) return precomputed;
    // Fallback: compute from raw logs (e.g. FAILED jobs where bulk upload never happened)
    const raw = await gcs.getRawLogs(jobId);
    if (raw.length === 0) return null;
    const games = structureGames(raw, deckNamesHint);
    return { games, deckNames: deckNamesHint };
  }
  const meta = readLocalMeta(jobId);
  if (meta?.structured) return { games: meta.structured, deckNames: meta.deckNames };
  // Fallback: compute from raw logs
  const raw = readLocalRawLogs(jobId);
  if (!raw) return null;
  const names = deckNamesHint ?? meta?.deckNames;
  const games = structureGames(raw, names);
  return { games, deckNames: names };
}

export async function getAnalyzePayloadData(
  jobId: string,
  deckNamesHint?: string[],
  deckListsHint?: string[]
): Promise<AnalyzePayload | null> {
  if (isGcpMode()) {
    const precomputed = await gcs.getJobArtifactJson<AnalyzePayload>(jobId, 'analyze-payload.json');
    if (precomputed) return precomputed;
    // Fallback: compute from raw logs via condensed data
    const condensed = await getCondensedLogs(jobId);
    if (!condensed || condensed.length === 0) return null;
    return buildAnalyzePayload(condensed, deckNamesHint, deckListsHint);
  }
  const meta = readLocalMeta(jobId);
  if (meta?.analyzePayload) return meta.analyzePayload;
  // Fallback: compute from condensed data
  const condensed = await getCondensedLogs(jobId);
  if (!condensed || condensed.length === 0) return null;
  return buildAnalyzePayload(condensed, deckNamesHint ?? meta?.deckNames, deckListsHint ?? meta?.deckLists);
}
