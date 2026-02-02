#!/usr/bin/env npx tsx
/**
 * Recompute logs for a job by re-reading game log files from disk and
 * re-posting them to the Log Analyzer. Use this after fixing batched-game
 * logic to refresh a job that was run before the fix (e.g. 4 runs x 3 games
 * stored as 4 games can be corrected to 12 games).
 *
 * Prerequisites:
 * - Raw log files must still exist in orchestrator-service/jobs/<jobId>/logs/
 * - Log Analyzer must be running (LOG_ANALYZER_URL)
 *
 * Usage (from orchestrator-service directory):
 *   npx tsx scripts/recompute-job-logs.ts <jobId>
 *
 * Example:
 *   npx tsx scripts/recompute-job-logs.ts c998d985-66d3-4048-9d97-80e6911123e4
 */

import * as path from 'path';
import { getJob, updateJobProgress } from '../lib/job-store';
import { readGameLogs } from '../lib/game-logs';

const JOBS_DIR = path.resolve(process.cwd(), 'jobs');
const LOG_ANALYZER_URL = process.env.LOG_ANALYZER_URL || 'http://localhost:3001';

async function main() {
  const jobId = process.argv[2];
  if (!jobId) {
    console.error('Usage: npx tsx scripts/recompute-job-logs.ts <jobId>');
    process.exit(1);
  }

  const job = getJob(jobId);
  if (!job) {
    console.error(`Job not found: ${jobId}`);
    process.exit(1);
  }

  const logsDir = path.join(JOBS_DIR, jobId, 'logs');
  const gameLogs = readGameLogs(logsDir, jobId);

  if (gameLogs.length === 0) {
    console.error(
      `No game log files found for job ${jobId} in ${logsDir}. ` +
        'Raw logs may have been cleaned up. Re-run the simulation to generate new logs.'
    );
    process.exit(1);
  }

  const deckNames = job.decks.map((d) => d.name);
  const deckLists = job.decks.map((d) => d.dck);

  // Invalidate cached condensed/structured so recomputation uses latest parsing logic
  const invalidateRes = await fetch(`${LOG_ANALYZER_URL}/jobs/${jobId}/cache`, {
    method: 'DELETE',
  });
  if (invalidateRes.ok) {
    console.log('Invalidated cached condensed/structured data.');
  } else if (invalidateRes.status !== 404) {
    console.warn(`Cache invalidation returned ${invalidateRes.status} (continuing anyway).`);
  }

  console.log(`Re-ingesting ${gameLogs.length} log file(s) for job ${jobId}...`);

  const response = await fetch(`${LOG_ANALYZER_URL}/jobs/${jobId}/logs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameLogs, deckNames, deckLists }),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`Log Analyzer error (${response.status}): ${text}`);
    process.exit(1);
  }

  // Log analyzer may split concatenated logs (e.g. 4 files → 12 games). Fetch actual count.
  const structuredRes = await fetch(`${LOG_ANALYZER_URL}/jobs/${jobId}/logs/structured`);
  const gamesCount = structuredRes.ok
    ? ((await structuredRes.json()) as { games?: unknown[] }).games?.length ?? gameLogs.length
    : gameLogs.length;

  updateJobProgress(jobId, gamesCount);
  console.log(`Done. Job ${jobId} now has ${gamesCount} games. Refresh the job page.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
