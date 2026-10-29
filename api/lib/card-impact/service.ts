/**
 * Card impact service: turns a finished job's raw logs into per-deck card
 * counters.
 *
 * Runs from aggregateJobResults, which already holds the job's raw logs,
 * so it costs no extra log reads, and one read plus one write per deck in
 * Firestore. Idempotent per job (the store records counted job ids).
 */
import { matchesDeckName } from '../condenser/deck-match';
import { splitConcatenatedGames } from '../condenser/patterns';
import { getCardStatsStore } from '../card-stats-store-factory';
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

/**
 * Add every game in `rawLogs` to the card counters of each of the job's decks.
 *
 * @param deckIds   The job's 4 deck ids, in seat order.
 * @param deckNames The matching deck names, as they appear in the job.
 */
export async function processJobForCardStats(
  jobId: string,
  deckIds: string[],
  deckNames: string[],
  rawLogs: string[],
): Promise<void> {
  const games = rawLogs.flatMap(splitConcatenatedGames).map(parseGameCards);
  if (games.length === 0) return;

  const store = getCardStatsStore();
  await Promise.all(
    deckIds.map((deckId, idx) =>
      store.addJob(deckId, jobId, (stats) => {
        for (const game of games) {
          const seat = seatFor(game, deckNames[idx] ?? '', idx);
          if (seat) addGame(stats, game, seat);
        }
        return stats;
      }),
    ),
  );
}
