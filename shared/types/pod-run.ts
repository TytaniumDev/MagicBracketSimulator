// ---------------------------------------------------------------------------
// Pod run — one selection of more than 4 decks, queued as every 4-deck pod.
// GET /api/pod-runs, GET /api/pod-runs/:id
// ---------------------------------------------------------------------------

import type { JobResults, JobSeat } from './job';

/** Most decks a single pod run may include. C(10, 4) = 210 pods. */
export const MAX_POD_RUN_DECKS = 10;

export interface PodRunSummary {
  id: string;
  /** Every deck in the run, in the order they were selected. */
  deckNames: string[];
  /** Number of pods (jobs) queued for the run. */
  podCount: number;
  /** Pods whose results are in the standings. */
  podsWithResults: number;
  /** Games per pod. */
  simulations: number;
  createdAt: string;
}

export interface PodRunResponse extends PodRunSummary {
  deckIds: string[];
  /** One job per pod, in the order they were queued. */
  jobIds: string[];
  /** Every deck that has played a finished pod, best first. */
  standings: DeckStanding[];
}

// ---------------------------------------------------------------------------
// Standings: each finished pod's results summed per deck. The API keeps the
// running totals on the pod run (copied up as each pod finishes), and the
// pod run page ranks them.
// ---------------------------------------------------------------------------

/** One deck's results summed across a run's finished pods. */
export interface DeckTotals {
  name: string;
  /** Finished pods this deck played in. */
  pods: number;
  gamesPlayed: number;
  wins: number;
  /** Sum of winning turns over `winTurnWins` wins, for the average. */
  winTurnSum: number;
  winTurnWins: number;
}

/** Running totals, keyed by deck id. */
export type PodRunTotals = Record<string, DeckTotals>;

export interface DeckStanding {
  /** The key the deck's totals are stored under. */
  key: string;
  name: string;
  pods: number;
  gamesPlayed: number;
  wins: number;
  /** wins / gamesPlayed, 0..1. In a 4-player pod an even deck sits at 0.25. */
  winRate: number;
  /** Win-weighted average winning turn, or null with no wins. */
  avgWinTurn: number | null;
}

/**
 * Add one finished pod's results to `totals`, returning new totals. A pod
 * without games played adds nothing.
 */
export function addPodResults(totals: PodRunTotals, seats: readonly JobSeat[], results: JobResults): PodRunTotals {
  if (results.gamesPlayed <= 0) return totals;
  const next = { ...totals };
  seats.forEach(({ deckId: key, name }, i) => {
    const entry = next[key] ?? { name, pods: 0, gamesPlayed: 0, wins: 0, winTurnSum: 0, winTurnWins: 0 };
    const wins = results.seats[i]?.wins ?? 0;
    const avgTurn = results.seats[i]?.avgWinTurn;
    const hasTurns = wins > 0 && typeof avgTurn === 'number' && avgTurn > 0;
    next[key] = {
      name: entry.name,
      pods: entry.pods + 1,
      gamesPlayed: entry.gamesPlayed + results.gamesPlayed,
      wins: entry.wins + wins,
      winTurnSum: entry.winTurnSum + (hasTurns ? avgTurn * wins : 0),
      winTurnWins: entry.winTurnWins + (hasTurns ? wins : 0),
    };
  });
  return next;
}

/** Totals as standings, sorted by win rate, then wins, then name. */
export function rankStandings(totals: PodRunTotals): DeckStanding[] {
  return Object.entries(totals)
    .map(([key, t]) => ({
      key,
      name: t.name,
      pods: t.pods,
      gamesPlayed: t.gamesPlayed,
      wins: t.wins,
      winRate: t.gamesPlayed > 0 ? t.wins / t.gamesPlayed : 0,
      avgWinTurn: t.winTurnWins > 0 ? t.winTurnSum / t.winTurnWins : null,
    }))
    .sort((a, b) => b.winRate - a.winRate || b.wins - a.wins || a.name.localeCompare(b.name));
}
