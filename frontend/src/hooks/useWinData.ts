import { useMemo } from 'react';
import { matchesDeckName } from '../utils/deck-match';
import type { JobResponse } from '@shared/types/job';
import type { SimulationStatus } from '@shared/types/simulation';
import type { StructuredGame } from '@shared/types/log';

export interface WinData {
  winTally: Record<string, number> | null;
  winTurns: Record<string, number[]> | null;
  gamesPlayed: number;
  simGamesCompleted: number;
}

// ---------------------------------------------------------------------------
// Pure computation functions (exported for testing)
// ---------------------------------------------------------------------------

export interface SimWinResult {
  simWinTally: Record<string, number> | null;
  simWinTurns: Record<string, number[]> | null;
  simGamesCompleted: number;
}

/**
 * Compute win tally from simulation statuses.
 * Prefers winners[] array (multi-game containers), falls back to single winner.
 */
export function computeSimWins(
  simulations: SimulationStatus[],
  deckNames: string[],
): SimWinResult {
  if (simulations.length === 0) {
    return { simWinTally: null, simWinTurns: null, simGamesCompleted: 0 };
  }

  const completedSims = simulations.filter((s) => s.state === 'COMPLETED');

  const hasAnyWinData = completedSims.some(
    (s) => (s.winners && s.winners.length > 0) || s.winner
  );
  if (!hasAnyWinData) {
    const gamesCompleted =
      completedSims.reduce((sum, s) => sum + (s.winners?.length ?? 0), 0) ||
      completedSims.length;
    return { simWinTally: null, simWinTurns: null, simGamesCompleted: gamesCompleted };
  }

  const tally: Record<string, number> = {};
  const turns: Record<string, number[]> = {};

  for (const name of deckNames) {
    tally[name] = 0;
    turns[name] = [];
  }

  for (const sim of completedSims) {
    const simWinners =
      sim.winners && sim.winners.length > 0
        ? sim.winners
        : sim.winner
          ? [sim.winner]
          : [];
    const simTurns =
      sim.winningTurns && sim.winningTurns.length > 0
        ? sim.winningTurns
        : sim.winningTurn !== undefined
          ? [sim.winningTurn]
          : [];

    for (let i = 0; i < simWinners.length; i++) {
      let matchedDeck = simWinners[i];
      const found = deckNames.find((name) => matchesDeckName(simWinners[i], name));
      if (found) matchedDeck = found;

      tally[matchedDeck] = (tally[matchedDeck] || 0) + 1;
      if (i < simTurns.length && simTurns[i] !== undefined) {
        if (!turns[matchedDeck]) turns[matchedDeck] = [];
        turns[matchedDeck].push(simTurns[i]);
      }
    }
  }

  for (const deck of Object.keys(turns)) {
    turns[deck].sort((a, b) => a - b);
  }

  const gamesCompleted =
    completedSims.reduce((sum, s) => sum + (s.winners?.length ?? 0), 0) ||
    completedSims.length;

  return { simWinTally: tally, simWinTurns: turns, simGamesCompleted: gamesCompleted };
}

export interface StructuredWinResult {
  structuredWinTally: Record<string, number> | null;
  structuredWinTurns: Record<string, number[]> | null;
}

/**
 * Compute win tally from structured game logs.
 */
export function computeStructuredWins(
  structuredGames: StructuredGame[] | null,
  logDeckNames: string[] | null,
): StructuredWinResult {
  if (!structuredGames || structuredGames.length === 0) {
    return { structuredWinTally: null, structuredWinTurns: null };
  }

  const tally: Record<string, number> = {};
  const turns: Record<string, number[]> = {};

  if (logDeckNames) {
    for (const name of logDeckNames) {
      tally[name] = 0;
      turns[name] = [];
    }
  }

  for (const game of structuredGames) {
    if (game.winner) {
      let matchedDeck = game.winner;
      if (logDeckNames) {
        const found = logDeckNames.find((name) => matchesDeckName(game.winner!, name));
        if (found) matchedDeck = found;
      }
      tally[matchedDeck] = (tally[matchedDeck] || 0) + 1;

      if (game.winningTurn !== undefined) {
        if (!turns[matchedDeck]) turns[matchedDeck] = [];
        turns[matchedDeck].push(game.winningTurn);
      }
    }
  }

  for (const deck of Object.keys(turns)) {
    turns[deck].sort((a, b) => a - b);
  }

  return { structuredWinTally: tally, structuredWinTurns: turns };
}

/**
 * Three-way fallback chain: server results → structured games → simulation statuses.
 */
export function resolveEffectiveWins(
  jobResults: JobResponse['results'],
  simResult: SimWinResult,
  structuredResult: StructuredWinResult,
  structuredGames: StructuredGame[] | null,
): WinData {
  const { structuredWinTally, structuredWinTurns } = structuredResult;
  const { simWinTally, simWinTurns, simGamesCompleted } = simResult;

  const winTally =
    jobResults?.wins ??
    (structuredWinTally && Object.keys(structuredWinTally).length > 0
      ? structuredWinTally
      : simWinTally);
  const winTurns =
    structuredWinTally && Object.keys(structuredWinTally).length > 0
      ? structuredWinTurns
      : simWinTurns;
  const gamesPlayed =
    jobResults?.gamesPlayed ??
    (structuredGames && structuredGames.length > 0
      ? structuredGames.length
      : simGamesCompleted);

  return { winTally, winTurns, gamesPlayed, simGamesCompleted };
}

// ---------------------------------------------------------------------------
// React hook wrapper
// ---------------------------------------------------------------------------

/**
 * Pure computation hook for the three-way win data fallback chain.
 *
 * Priority order:
 * 1. job.results.wins (server-aggregated, authoritative)
 * 2. structuredGames winners (parsed from detailed logs)
 * 3. simulation status winners (real-time tracking)
 */
export function useWinData(
  job: JobResponse | null,
  simulations: SimulationStatus[],
  structuredGames: StructuredGame[] | null,
  logDeckNames: string[] | null,
): WinData {
  const simResult = useMemo(
    () => computeSimWins(simulations, job?.deckNames ?? []),
    [simulations, job?.deckNames],
  );

  const structuredResult = useMemo(
    () => computeStructuredWins(structuredGames, logDeckNames),
    [structuredGames, logDeckNames],
  );

  return resolveEffectiveWins(job?.results ?? null, simResult, structuredResult, structuredGames);
}
