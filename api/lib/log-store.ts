/**
 * Log storage abstraction — local filesystem or GCS depending on mode.
 *
 * LOCAL mode: stores logs as files under `logs-data/{jobId}/`
 * GCP mode: stores logs in Cloud Storage via gcs-storage.ts (gzipped)
 *
 * Raw logs are kept as the worker uploaded them: one file per simulation,
 * each holding up to GAMES_PER_CONTAINER games (older jobs hold one game per
 * file). Readers get them split into single games. They are kept forever;
 * aggregation only adds the derived condensed and structured data.
 */

import * as fs from 'fs';
import * as path from 'path';
import { isGcpMode } from './env';
import * as gcs from './gcs-storage';
import { condenseGames, structureGames, splitConcatenatedGames } from './condenser/index';
import type { CondensedGame, StructuredGame } from './types';
import * as Sentry from '@sentry/nextjs';

// Local filesystem storage directory
const LOGS_DATA_DIR = process.env.LOGS_DATA_DIR ?? path.join(process.cwd(), 'logs-data');

/**
 * Max bytes for a single simulation log upload. Forge logs for a full game
 * are typically <500 KB; 10 MB gives ~20x headroom and caps runaway / malicious
 * uploads before they can OOM the API or balloon GCS costs.
 */
export const MAX_LOG_BYTES = 10 * 1024 * 1024;

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

interface StoredMeta {
  deckNames?: string[];
  deckLists?: string[];
  ingestedAt: string;
  condensed?: CondensedGame[];
  structured?: StructuredGame[];
}

// ─── Ingest (POST) ──────────────────────────────────────────────────────────

/**
 * Pre-compute condensed and structured data from a job's raw logs (already
 * stored, as uploaded by the worker).
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

  if (isGcpMode()) {
    await gcs.uploadJobArtifact(jobId, 'condensed.json', JSON.stringify(condensed));
    await gcs.uploadJobArtifact(jobId, 'structured.json', JSON.stringify({ games: structured, deckNames }));
  } else {
    const meta: StoredMeta = {
      deckNames,
      deckLists,
      ingestedAt: new Date().toISOString(),
      condensed,
      structured,
    };
    fs.mkdirSync(getJobDir(jobId), { recursive: true });
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

// ─── Read helpers (GET) ──────────────────────────────────────────────────────

function readLocalMeta(jobId: string): StoredMeta | null {
  const metaPath = getMetaPath(jobId);
  if (!fs.existsSync(metaPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as StoredMeta;
  } catch (err) {
    Sentry.captureException(err, { tags: { component: 'log-store', jobId } });
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

/** The job's raw logs, one entry per game, or null when none were uploaded. */
export async function getRawLogs(jobId: string): Promise<string[] | null> {
  const files = isGcpMode() ? await gcs.getRawLogs(jobId) : readLocalRawLogs(jobId);
  if (!files || files.length === 0) return null;
  return files.flatMap(splitConcatenatedGames);
}

export async function getCondensedLogs(jobId: string): Promise<CondensedGame[] | null> {
  if (isGcpMode()) {
    const precomputed = await gcs.getJobArtifactJson<CondensedGame[]>(jobId, 'condensed.json');
    if (precomputed) return precomputed;
  } else {
    const meta = readLocalMeta(jobId);
    if (meta?.condensed) return meta.condensed;
  }
  // Fallback: compute from raw logs (e.g. FAILED jobs that were never aggregated)
  const raw = await getRawLogs(jobId);
  return raw ? condenseGames(raw) : null;
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
  }
  const meta = isGcpMode() ? null : readLocalMeta(jobId);
  if (meta?.structured) return { games: meta.structured, deckNames: meta.deckNames };
  // Fallback: compute from raw logs (e.g. FAILED jobs that were never aggregated)
  const raw = await getRawLogs(jobId);
  if (!raw) return null;
  const names = deckNamesHint ?? meta?.deckNames;
  return { games: structureGames(raw, names), deckNames: names };
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
