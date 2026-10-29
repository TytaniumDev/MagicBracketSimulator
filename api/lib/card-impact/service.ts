/**
 * Card impact service: turns a finished job's raw logs into per-deck card
 * counters.
 *
 * Runs from aggregateJobResults, which already holds the job's raw logs,
 * so it costs no extra log reads, and one read plus one write per deck in
 * Firestore. The backfill batches many jobs into that same one write per
 * deck. Idempotent per job (the store records counted job ids).
 */
import { matchesDeckName } from '../condenser/deck-match';
import { splitConcatenatedGames } from '../condenser/patterns';
import { getCardStatsStore } from '../card-stats-store-factory';
import type { CardStatsJobUpdate } from '../card-stats-store';
import { parseGameCards, type GameCardSummary } from './parse';
import { addGame } from './stats';

/**
 * Which player label is this deck's seat. Forge seats decks in job order as
 * Ai(1)..Ai(4); the name match covers logs where that numbering differs.
 */
export function seatFor(game: GameCardSummary, deckName: string, deckIndex: number): string | null {
  const labels = Object.keys(game.turnsTaken);
  return (
    labels.find((label) => matchesDeckName(label, deckName)) ??
    labels.find((label) => label.startsWith(`Ai(${deckIndex + 1})-`)) ??
    null
  );
}

/** A finished job's logs and decks, for card stats. */
export interface CardStatsJob {
  jobId: string;
  /** The job's 4 deck ids, in seat order. */
  deckIds: string[];
  /** The matching deck names, as they appear in the job. */
  deckNames: string[];
  rawLogs: string[];
}

/**
 * A job's games reduced to the card signals card stats need. Much smaller
 * than its raw logs, so a page of jobs fits in memory where their raw logs
 * (several MB per job) would not.
 */
export interface ParsedCardStatsJob {
  jobId: string;
  deckIds: string[];
  deckNames: string[];
  games: GameCardSummary[];
}

/** Parse a job's raw logs, so the caller can drop them before reading the next job. */
export function parseCardStatsJob({ rawLogs, ...job }: CardStatsJob): ParsedCardStatsJob {
  return { ...job, games: rawLogs.flatMap(splitConcatenatedGames).map(parseGameCards) };
}

/** Each deck's counter update for one job, or nothing if it holds no games. */
function deckUpdatesForJob(job: ParsedCardStatsJob): Map<string, CardStatsJobUpdate> {
  const updates = new Map<string, CardStatsJobUpdate>();
  if (job.games.length === 0) return updates;

  job.deckIds.forEach((deckId, idx) => {
    updates.set(deckId, {
      jobId: job.jobId,
      update: (stats) => {
        for (const game of job.games) {
          const seat = seatFor(game, job.deckNames[idx] ?? '', idx);
          if (seat) addGame(stats, game, seat);
        }
        return stats;
      },
    });
  });
  return updates;
}

/**
 * Add every game in the parsed jobs to their decks' card counters, with one
 * store write per deck however many jobs mention it. Already counted jobs
 * are skipped.
 */
export async function processJobsForCardStats(jobs: ParsedCardStatsJob[]): Promise<void> {
  const byDeck = new Map<string, CardStatsJobUpdate[]>();
  for (const job of jobs) {
    for (const [deckId, update] of deckUpdatesForJob(job)) {
      byDeck.set(deckId, [...(byDeck.get(deckId) ?? []), update]);
    }
  }

  const store = getCardStatsStore();
  await Promise.all([...byDeck].map(([deckId, updates]) => store.addJobs(deckId, updates)));
}

/** Add one finished job's games to its decks' card counters. */
export async function processJobForCardStats(
  jobId: string,
  deckIds: string[],
  deckNames: string[],
  rawLogs: string[],
): Promise<void> {
  await processJobsForCardStats([parseCardStatsJob({ jobId, deckIds, deckNames, rawLogs })]);
}
