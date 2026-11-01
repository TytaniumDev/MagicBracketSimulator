/**
 * Card impact service: turns a finished job's raw logs into per-deck card
 * counters.
 *
 * Runs from aggregateJobResults, which parses each game's card signals
 * while it walks the job's raw logs, so it costs no extra log reads, and
 * one read plus one write per deck in Firestore. The backfill batches many
 * jobs into that same one write per deck. Idempotent per job (the store
 * records counted job ids).
 *
 * Each counted job also gets a receipt next to its logs (card-stats.json):
 * its own counters per deck. Deleting the job subtracts the receipt, so a
 * delete never has to re-read the job's raw logs.
 */
import * as Sentry from '@sentry/nextjs';
import { matchesDeckName } from '../condenser/deck-match';
import { getCardStatsStore } from '../card-stats-store-factory';
import type { CardStatsJobUpdate } from '../card-stats-store';
import { forEachRawGame, readJobJson, saveJobJson } from '../log-store';
import type { JobSeat } from '../types';
import { seatNames } from '@shared/types/job';
import { parseGameCards, type GameCardSummary } from './parse';
import { addGame, CARD_STATS_VERSION, combineCardStats, emptyDeckCardStats, type DeckCardStats } from './stats';

/** The receipt's file name, next to the job's raw logs. */
const RECEIPT_FILE = 'card-stats.json';

/** What one job added to each of its decks' counters, keyed by deck id. */
interface CardStatsReceipt {
  version: number;
  decks: Record<string, DeckCardStats>;
}

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

/**
 * The job's own counters for each of its decks: what counting it adds.
 * Empty when it holds no games.
 */
export function countJobCards(job: ParsedCardStatsJob): Map<string, DeckCardStats> {
  const counts = new Map<string, DeckCardStats>();
  if (job.games.length === 0) return counts;

  job.deckIds.forEach((deckId, idx) => {
    const stats = emptyDeckCardStats();
    for (const game of job.games) {
      const seat = seatFor(game, job.deckNames[idx] ?? '', idx);
      if (seat) addGame(stats, game, seat);
    }
    counts.set(deckId, stats);
  });
  return counts;
}

/** Save the job's counters next to its logs. A failure is reported; the delete falls back to the logs. */
async function saveReceipt(jobId: string, counts: Map<string, DeckCardStats>): Promise<void> {
  const receipt: CardStatsReceipt = { version: CARD_STATS_VERSION, decks: Object.fromEntries(counts) };
  try {
    await saveJobJson(jobId, RECEIPT_FILE, receipt);
  } catch (err) {
    Sentry.captureException(err, { tags: { component: 'card-stats-receipt', jobId } });
  }
}

/**
 * Add every game in the parsed jobs to their decks' card counters, with one
 * store write per deck however many jobs mention it. Already counted jobs
 * are skipped.
 */
export async function processJobsForCardStats(jobs: ParsedCardStatsJob[]): Promise<void> {
  const byDeck = new Map<string, CardStatsJobUpdate[]>();
  for (const job of jobs) {
    const counts = countJobCards(job);
    if (counts.size === 0) continue;
    // Saved before counting, so a counted job always has its receipt.
    await saveReceipt(job.jobId, counts);
    for (const [deckId, deckCounts] of counts) {
      const update: CardStatsJobUpdate = {
        jobId: job.jobId,
        update: (stats) => combineCardStats(stats, deckCounts, 1),
      };
      byDeck.set(deckId, [...(byDeck.get(deckId) ?? []), update]);
    }
  }

  const store = getCardStatsStore();
  await Promise.all([...byDeck].map(([deckId, updates]) => store.addJobs(deckId, updates)));
}

/** The job's receipt, if it was written by the current parser. */
async function readReceipt(jobId: string): Promise<Map<string, DeckCardStats> | null> {
  const receipt = await readJobJson<CardStatsReceipt>(jobId, RECEIPT_FILE);
  return receipt?.version === CARD_STATS_VERSION ? new Map(Object.entries(receipt.decks)) : null;
}

/** Count the job's raw logs again, for a job counted without a receipt. */
async function recountJob(jobId: string, seats: JobSeat[]): Promise<Map<string, DeckCardStats>> {
  const games: GameCardSummary[] = [];
  await forEachRawGame(jobId, (game) => games.push(parseGameCards(game)));
  return countJobCards({ jobId, deckIds: seats.map((s) => s.deckId), deckNames: seatNames(seats), games });
}

/**
 * Take a deleted job's games back out of its decks' card counters, from its
 * receipt (or its raw logs when it has none and some deck counted it).
 * Decks that never counted it are left alone. Call before the job's logs
 * are deleted, since the receipt lives with them. Returns how many decks
 * changed.
 */
export async function removeJobFromCardStats(jobId: string, seats: JobSeat[]): Promise<number> {
  const store = getCardStatsStore();
  let counts = await readReceipt(jobId);
  if (!counts) {
    // Re-reading the logs is slow; only do it if some deck counted the job.
    const deckIds = [...new Set(seats.map((s) => s.deckId))];
    const stored = await Promise.all(deckIds.map((id) => store.get(id)));
    if (!stored.some((stats) => stats?.jobIds.includes(jobId))) return 0;
    counts = await recountJob(jobId, seats);
  }

  const removed = await Promise.all(
    [...counts].map(([deckId, deckCounts]) =>
      store.removeJob(deckId, { jobId, update: (stats) => combineCardStats(stats, deckCounts, -1) }),
    ),
  );
  return removed.filter(Boolean).length;
}
