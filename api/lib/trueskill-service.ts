/**
 * Rating stats service.
 *
 * Applies a finished job's games to per-deck wins/gamesPlayed counters and
 * pair game counts, once per job (see RatingStore.applyJob), and takes them
 * back when the job is deleted (RatingStore.removeJob). The leaderboard then ranks decks with a Bayesian-adjusted win
 * rate (see api/app/api/leaderboard/route.ts).
 *
 * Historical note: this module previously computed TrueSkill (mu/sigma)
 * ratings. That math was removed in favor of the simpler Bayesian win-rate
 * ranking. mu/sigma are still present in the DeckRating schema so existing
 * Firestore docs remain valid; new writes leave mu/sigma at neutral defaults.
 */
import type { DeckRating, GameSummary, JobSeat } from './types';
import { seatOfPlayer } from './condenser/deck-match';
import { getDeckById } from './deck-store-factory';
import { getRatingStore } from './rating-store-factory';
import { addWinTurn, emptyWinTurnAggregate, type WinTurnAggregate } from './win-turn-aggregate';
import * as Sentry from '@sentry/nextjs';

const MU_DEFAULT = 25;
const SIGMA_DEFAULT = 25 / 3;

/**
 * Process all games in a completed job and update per-deck win/game counters.
 *
 * Fire-and-forget — called from aggregateJobResults with a .catch() so
 * failures never break job completion.
 *
 * @param jobId  The job ID (for idempotency).
 * @param seats  The job's 4 seats.
 * @param games  Each game's winner and winning turn (from the game index).
 * @returns false when the job was already rated.
 */
export async function processJobForRatings(
  jobId: string,
  seats: JobSeat[],
  games: readonly GameSummary[],
): Promise<boolean> {
  const deckIds = seats.map((s) => s.deckId);
  const seatNames = seats.map((s) => s.name);
  const deckInfos = await Promise.all(
    deckIds.map(async (id) => {
      const deck = await getDeckById(id);
      return {
        id,
        name: deck?.name ?? null,
        setName: deck?.setName ?? null,
        isPrecon: deck?.isPrecon ?? false,
        primaryCommander: deck?.primaryCommander ?? null,
      };
    }),
  );

  // Resolve each game's winner to a seat once, outside the store transaction.
  const resolved = resolveGames(jobId, seatNames, games);
  const jobTimestamp = new Date().toISOString();
  const applied = await getRatingStore().applyJob({
    jobId,
    deckIds,
    gameCount: games.length,
    update: (stored) => {
      if (resolved.length === 0) return null;
      return stored.map((rating, idx) =>
        withCounts(withDeckInfo(rating ?? newRating(deckIds[idx]!), deckInfos[idx]!), seatCounts(resolved, idx), 1, jobTimestamp),
      );
    },
  });

  if (!applied) {
    console.log(`[RatingStats] Job ${jobId} already rated, skipping`);
  } else if (resolved.length > 0) {
    console.log(
      `[RatingStats] Job ${jobId}: recorded ${resolved.length}/${games.length} game(s) for decks [${deckIds.join(', ')}]`,
    );
  } else {
    Sentry.addBreadcrumb({
      category: 'rating-stats',
      message: `Job ${jobId}: no games had resolvable winners — counters unchanged`,
      level: 'warning',
      data: { jobId, gameCount: games.length, deckIds },
    });
  }
  return applied;
}

/**
 * Take a deleted job's games back out of its decks' win/game counters and
 * pair game counts. The inverse of processJobForRatings, given the same games.
 *
 * @returns false when the job's games were never counted.
 */
export async function removeJobFromRatings(
  jobId: string,
  seats: JobSeat[],
  games: readonly GameSummary[],
): Promise<boolean> {
  const resolved = resolveGames(jobId, seats.map((s) => s.name), games);
  const at = new Date().toISOString();
  return getRatingStore().removeJob({
    jobId,
    deckIds: seats.map((s) => s.deckId),
    gameCount: games.length,
    update: (stored) => {
      if (resolved.length === 0) return null;
      return stored.map((rating, idx) => rating && withCounts(rating, seatCounts(resolved, idx), -1, at));
    },
  });
}

interface DeckInfo {
  name: string | null;
  setName: string | null;
  isPrecon: boolean;
  primaryCommander: string | null;
}

function newRating(deckId: string): DeckRating {
  return {
    deckId,
    mu: MU_DEFAULT,
    sigma: SIGMA_DEFAULT,
    gamesPlayed: 0,
    wins: 0,
    lastUpdated: new Date().toISOString(),
  };
}

/** Refresh the denormalized deck metadata the leaderboard reads. */
function withDeckInfo(rating: DeckRating, info: DeckInfo): DeckRating {
  return {
    ...rating,
    deckName: info.name ?? undefined,
    setName: info.setName,
    isPrecon: info.isPrecon,
    primaryCommander: info.primaryCommander,
  };
}

interface ResolvedGame {
  winnerIdx: number;
  winningTurn: number | null;
}

/** Each game's winning seat and turn. Games whose winner matches no seat are left out. */
function resolveGames(jobId: string, seatNames: string[], games: readonly GameSummary[]): ResolvedGame[] {
  const resolved: ResolvedGame[] = [];
  games.forEach((game, i) => {
    const winner = game.winner;
    const winnerIdx = winner ? seatOfPlayer(winner, seatNames) : -1;
    if (winnerIdx === -1) {
      Sentry.addBreadcrumb({
        category: 'rating-stats',
        message: `Game ${i} in job ${jobId}: winner "${winner}" could not be resolved to a deck ID`,
        level: 'warning',
        data: { jobId, gameIndex: i, winner, seatNames },
      });
      return;
    }
    resolved.push({ winnerIdx, winningTurn: game.winningTurn ?? null });
  });
  return resolved;
}

/** What a job's resolved games add to one seat's deck. */
interface SeatCounts {
  games: number;
  wins: number;
  winTurns: WinTurnAggregate;
}

function seatCounts(resolved: readonly ResolvedGame[], seat: number): SeatCounts {
  let winTurns = emptyWinTurnAggregate();
  let wins = 0;
  for (const { winnerIdx, winningTurn } of resolved) {
    if (winnerIdx !== seat) continue;
    wins++;
    if (winningTurn != null) winTurns = addWinTurn(winTurns, winningTurn);
  }
  return { games: resolved.length, wins, winTurns };
}

/**
 * Add a seat's counts to a deck's rating (sign 1), or take them back (-1)
 * when its job is deleted. Counters never go below zero.
 */
function withCounts(rating: DeckRating, counts: SeatCounts, sign: 1 | -1, at: string): DeckRating {
  const plus = (stored: number | undefined, n: number) => Math.max((stored ?? 0) + sign * n, 0);
  const histogram = rating.winTurnHistogram ?? emptyWinTurnAggregate().winTurnHistogram;
  return {
    ...rating,
    gamesPlayed: plus(rating.gamesPlayed, counts.games),
    wins: plus(rating.wins, counts.wins),
    winTurnSum: plus(rating.winTurnSum, counts.winTurns.winTurnSum),
    winTurnWins: plus(rating.winTurnWins, counts.winTurns.winTurnWins),
    winTurnHistogram: histogram.map((n, i) => plus(n, counts.winTurns.winTurnHistogram[i] ?? 0)),
    lastUpdated: at,
  };
}
