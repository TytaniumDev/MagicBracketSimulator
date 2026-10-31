/**
 * Rating stats service.
 *
 * Applies a finished job's games to per-deck wins/gamesPlayed counters and
 * pair game counts, once per job (see RatingStore.applyJob). The leaderboard then ranks decks with a Bayesian-adjusted win
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
import { addWinTurn, emptyWinTurnAggregate } from './win-turn-aggregate';
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
  const resolved: { winnerIdx: number; winningTurn: number | null }[] = [];
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

  const jobTimestamp = new Date().toISOString();
  const applied = await getRatingStore().applyJob({
    jobId,
    deckIds,
    gameCount: games.length,
    update: (stored) => {
      if (resolved.length === 0) return null;
      const ratings = stored.map((rating, idx) => withDeckInfo(rating ?? newRating(deckIds[idx]!), deckInfos[idx]!));
      for (const { winnerIdx, winningTurn } of resolved) {
        for (let j = 0; j < ratings.length; j++) {
          ratings[j] = addGame(ratings[j]!, j === winnerIdx, winningTurn, jobTimestamp);
        }
      }
      return ratings;
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

/** Count one resolved game for a deck: a game played, and a win with its turn if it won. */
function addGame(rating: DeckRating, won: boolean, winningTurn: number | null, at: string): DeckRating {
  const next: DeckRating = {
    ...rating,
    gamesPlayed: rating.gamesPlayed + 1,
    wins: rating.wins + (won ? 1 : 0),
    lastUpdated: at,
  };
  if (!won || winningTurn == null) return next;
  return {
    ...next,
    ...addWinTurn(
      {
        winTurnSum: rating.winTurnSum ?? 0,
        winTurnWins: rating.winTurnWins ?? 0,
        winTurnHistogram: rating.winTurnHistogram ?? emptyWinTurnAggregate().winTurnHistogram,
      },
      winningTurn,
    ),
  };
}
