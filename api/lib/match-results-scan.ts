/**
 * Helpers for the one-off win-turn backfill. Reads match_results
 * and groups by winnerDeckId, producing a per-deck WinTurnAggregate.
 */
import type { MatchResult } from './types';
import { addWinTurn, emptyWinTurnAggregate, type WinTurnAggregate } from './win-turn-aggregate';

export function aggregateMatchResultsByWinner(
  results: Iterable<MatchResult>,
): Map<string, WinTurnAggregate> {
  const byDeck = new Map<string, WinTurnAggregate>();
  for (const r of results) {
    if (!r.winnerDeckId || r.turnCount == null) continue;
    const prev = byDeck.get(r.winnerDeckId) ?? emptyWinTurnAggregate();
    byDeck.set(r.winnerDeckId, addWinTurn(prev, r.turnCount));
  }
  return byDeck;
}
