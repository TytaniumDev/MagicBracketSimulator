/**
 * Turn a stored DeckRating into the display stats shared by the leaderboard
 * and the deck page, so both rank and describe decks the same way.
 */
import type { DeckRating } from './types';
import type { DeckStats } from '@shared/types/deck';

// Prior: expected win rate in a 4-player free-for-all is 25%.
// Weight: equivalent to "40 games of 25%" mixed in — a new deck scores exactly
// the prior, and the prior's influence fades as real games accumulate.
const PRIOR_WIN_RATE = 0.25;
const PRIOR_WEIGHT = 40;
const PRIOR_WINS = PRIOR_WEIGHT * PRIOR_WIN_RATE;

const HISTOGRAM_BINS = 16;

/** Bayesian-adjusted win rate as a percentage. */
export function bayesianScore(wins: number, gamesPlayed: number): number {
  return ((wins + PRIOR_WINS) / (gamesPlayed + PRIOR_WEIGHT)) * 100;
}

export function toDeckStats(r: DeckRating): DeckStats {
  const winTurnWins = r.winTurnWins ?? 0;
  const hasHistogram =
    Array.isArray(r.winTurnHistogram) &&
    r.winTurnHistogram.length === HISTOGRAM_BINS &&
    r.winTurnHistogram.some((n) => n > 0);
  return {
    rating: bayesianScore(r.wins, r.gamesPlayed),
    gamesPlayed: r.gamesPlayed,
    wins: r.wins,
    winRate: r.gamesPlayed > 0 ? r.wins / r.gamesPlayed : 0,
    avgWinTurn: winTurnWins > 0 ? (r.winTurnSum ?? 0) / winTurnWins : null,
    winTurnHistogram: hasHistogram ? r.winTurnHistogram! : null,
  };
}
