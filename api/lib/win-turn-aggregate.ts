/**
 * Pure helpers for the per-deck win-turn aggregate stored on DeckRating.
 *
 * Bin scheme: 16 fixed bins. Bin 0 = turn 1, bin 14 = turn 15,
 * bin 15 = turn 16 or greater. Turn values ≤ 0 clamp up to bin 0,
 * values ≥ 16 clamp down to bin 15. `winTurnSum` records the raw
 * (unclamped) turn value so the displayed average is faithful even
 * when the distribution has a long tail.
 */

export interface WinTurnAggregate {
  winTurnSum: number;
  winTurnWins: number;
  winTurnHistogram: number[];
}

export const WIN_TURN_BIN_COUNT = 16;

export function emptyWinTurnAggregate(): WinTurnAggregate {
  return {
    winTurnSum: 0,
    winTurnWins: 0,
    winTurnHistogram: new Array(WIN_TURN_BIN_COUNT).fill(0),
  };
}

export function addWinTurn(agg: WinTurnAggregate, turn: number): WinTurnAggregate {
  const bin = Math.min(Math.max(turn, 1), WIN_TURN_BIN_COUNT) - 1;
  const histogram = [...agg.winTurnHistogram];
  histogram[bin] = (histogram[bin] ?? 0) + 1;
  return {
    winTurnSum: agg.winTurnSum + turn,
    winTurnWins: agg.winTurnWins + 1,
    winTurnHistogram: histogram,
  };
}
