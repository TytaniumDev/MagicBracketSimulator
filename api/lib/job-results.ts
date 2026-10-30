/**
 * A job's results from its structured games: wins and average winning turn
 * per seat.
 */
import { seatOfPlayer } from './condenser/deck-match';
import type { JobResults, StructuredGame } from './types';

export function computeJobResults(
  games: readonly Pick<StructuredGame, 'winner' | 'winningTurn'>[],
  seatNames: readonly string[],
): JobResults {
  const winTurns: number[][] = seatNames.map(() => []);
  const wins = seatNames.map(() => 0);
  for (const game of games) {
    if (!game.winner) continue;
    const seat = seatOfPlayer(game.winner, seatNames);
    if (seat < 0) continue;
    wins[seat]++;
    if (game.winningTurn) winTurns[seat]!.push(game.winningTurn);
  }
  return {
    gamesPlayed: games.length,
    seats: wins.map((w, i) => {
      const turns = winTurns[i]!;
      const avg = turns.length > 0 ? turns.reduce((a, b) => a + b, 0) / turns.length : null;
      return { wins: w, avgWinTurn: avg === null ? null : Math.round(avg * 10) / 10 };
    }),
  };
}
