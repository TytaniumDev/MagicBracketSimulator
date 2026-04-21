/**
 * Rating stats service.
 *
 * Records per-job match results and increments per-deck wins/gamesPlayed
 * counters. The leaderboard then ranks decks with a Bayesian-adjusted win
 * rate (see api/app/api/leaderboard/route.ts).
 *
 * Historical note: this module previously computed TrueSkill (mu/sigma)
 * ratings. That math was removed in favor of the simpler Bayesian win-rate
 * ranking. mu/sigma are still present in the DeckRating schema so existing
 * Firestore docs remain valid; new writes leave mu/sigma at neutral defaults.
 */
import type { DeckRating, MatchResult, StructuredGame } from './types';
import { matchesDeckName } from './condenser/deck-match';
import { getDeckById } from './deck-store-factory';
import { getRatingStore } from './rating-store-factory';
import * as Sentry from '@sentry/nextjs';

const MU_DEFAULT = 25;
const SIGMA_DEFAULT = 25 / 3;

/**
 * Process all games in a completed job and update per-deck win/game counters.
 *
 * Fire-and-forget — called from aggregateJobResults with a .catch() so
 * failures never break job completion.
 *
 * @param jobId    The job ID (for idempotency).
 * @param deckIds  4 deck IDs (same order used throughout the job).
 * @param games    Structured game data (already ingested by ingestLogs).
 */
export async function processJobForRatings(
  jobId: string,
  deckIds: string[],
  games: StructuredGame[],
): Promise<void> {
  const store = getRatingStore();

  if (await store.hasMatchResultsForJob(jobId)) {
    console.log(`[RatingStats] Job ${jobId} already rated, skipping`);
    return;
  }

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

  const initialStoredRatings = await Promise.all(deckIds.map((id) => store.getRating(id)));

  const currentRatings: DeckRating[] = deckIds.map((id, idx) => {
    const stored = initialStoredRatings[idx];
    const info = deckInfos[idx]!;
    const base = stored ?? {
      deckId: id,
      mu: MU_DEFAULT,
      sigma: SIGMA_DEFAULT,
      gamesPlayed: 0,
      wins: 0,
      lastUpdated: new Date().toISOString(),
    };
    return {
      ...base,
      deckName: info.name ?? undefined,
      setName: info.setName,
      isPrecon: info.isPrecon,
      primaryCommander: info.primaryCommander,
    };
  });

  const matchResults: MatchResult[] = [];
  let updatedAtLeastOne = false;

  for (let i = 0; i < games.length; i++) {
    const game = games[i]!;
    const winner = game.winner;

    let winnerDeckId: string | null = null;
    if (winner) {
      for (const { id, name } of deckInfos) {
        if (name && matchesDeckName(winner, name)) {
          winnerDeckId = id;
          break;
        }
      }
    }

    matchResults.push({
      id: `${jobId}_${i}`,
      jobId,
      gameIndex: i,
      deckIds,
      winnerDeckId,
      turnCount: game.winningTurn ?? null,
      playedAt: new Date().toISOString(),
    });

    if (!winnerDeckId) {
      Sentry.addBreadcrumb({
        category: 'rating-stats',
        message: `Game ${i} in job ${jobId}: winner "${winner}" could not be resolved to a deck ID`,
        level: 'warning',
        data: { jobId, gameIndex: i, winner, deckNames: deckInfos.map(d => d.name) },
      });
      continue;
    }

    const winnerIdx = deckIds.indexOf(winnerDeckId);
    if (winnerIdx === -1) continue;

    for (let j = 0; j < deckIds.length; j++) {
      const current = currentRatings[j]!;
      currentRatings[j] = {
        ...current,
        gamesPlayed: current.gamesPlayed + 1,
        wins: current.wins + (j === winnerIdx ? 1 : 0),
        lastUpdated: new Date().toISOString(),
      };
    }
    updatedAtLeastOne = true;
  }

  for (const result of matchResults) {
    await store.recordMatchResult(result);
  }

  if (updatedAtLeastOne) {
    await store.updateRatings(currentRatings);
    console.log(
      `[RatingStats] Job ${jobId}: recorded ${games.length} game(s) for decks [${deckIds.join(', ')}]`,
    );
  } else {
    Sentry.addBreadcrumb({
      category: 'rating-stats',
      message: `Job ${jobId}: no games had resolvable winners — counters unchanged`,
      level: 'warning',
      data: { jobId, gameCount: games.length, deckIds },
    });
  }
}
