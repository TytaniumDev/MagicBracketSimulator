/**
 * Pod-run helpers: split a deck selection larger than one pod into every
 * 4-deck pod, and roll the finished pods' results up into per-deck standings.
 *
 * Pods are combinations, not ordered permutations. Forge decides turn order
 * per game, so seating the same four decks differently is the same matchup.
 */
import { REQUIRED_DECK_COUNT } from '@shared/types/job';
import type { JobResponse } from '@shared/types/job';

export { MAX_POD_RUN_DECKS } from '@shared/types/pod-run';

/** Every way to pick `size` items from `items`, in input order. */
export function podCombinations<T>(items: readonly T[], size: number = REQUIRED_DECK_COUNT): T[][] {
  const pods: T[][] = [];
  const current: T[] = [];
  const pick = (start: number) => {
    if (current.length === size) {
      pods.push([...current]);
      return;
    }
    for (let i = start; i <= items.length - (size - current.length); i++) {
      current.push(items[i]);
      pick(i + 1);
      current.pop();
    }
  };
  pick(0);
  return pods;
}

/** Number of pods for `deckCount` decks: C(deckCount, size). */
export function countPods(deckCount: number, size: number = REQUIRED_DECK_COUNT): number {
  if (deckCount < size) return 0;
  let result = 1;
  for (let i = 0; i < size; i++) {
    result = (result * (deckCount - i)) / (i + 1);
  }
  return Math.round(result);
}

// ---------------------------------------------------------------------------
// Pod-run URLs. Saved runs live at /pods/:id. Before runs were saved, a run
// was just the list of its job ids in the URL; those links still work, and
// the jobs-list form is the fallback if saving a run fails.
// ---------------------------------------------------------------------------

export function savedPodRunPath(podRunId: string): string {
  return `/pods/${encodeURIComponent(podRunId)}`;
}

export function podRunPath(jobIds: readonly string[]): string {
  return `/pods?jobs=${jobIds.map(encodeURIComponent).join(',')}`;
}

export function parsePodRunJobIds(search: string): string[] {
  const raw = new URLSearchParams(search).get('jobs') ?? '';
  return raw.split(',').map((id) => id.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Live updates
// ---------------------------------------------------------------------------

/** Most ids one Firestore `in` query may match. */
export const FIRESTORE_IN_LIMIT = 30;

/**
 * Split a run's job ids into fixed batches of `size` (by position, so a batch
 * never changes as pods finish) and keep only the batches that still have an
 * unfinished pod. Each kept batch gets one live listener.
 */
export function activePodChunks(
  jobIds: readonly string[],
  unfinishedIds: ReadonlySet<string>,
  size: number = FIRESTORE_IN_LIMIT,
): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < jobIds.length; i += size) {
    const chunk = jobIds.slice(i, i + size);
    if (chunk.some((id) => unfinishedIds.has(id))) chunks.push(chunk);
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Standings
// ---------------------------------------------------------------------------

export interface DeckStanding {
  name: string;
  /** Finished pods this deck played in. */
  pods: number;
  gamesPlayed: number;
  wins: number;
  /** wins / gamesPlayed, 0..1. In a 4-player pod an even deck sits at 0.25. */
  winRate: number;
  /** Win-weighted average winning turn, or null with no wins. */
  avgWinTurn: number | null;
}

/**
 * Sum per-deck results across every pod that has them. Pods still queued,
 * running, or failed without results are skipped. Sorted by win rate, then
 * wins, then name.
 */
export function aggregatePodStandings(jobs: readonly JobResponse[]): DeckStanding[] {
  const totals = new Map<string, { pods: number; games: number; wins: number; winTurnSum: number; winTurnWins: number }>();

  for (const job of jobs) {
    const results = job.results;
    if (!results || results.gamesPlayed <= 0) continue;
    for (const name of job.deckNames) {
      const entry = totals.get(name) ?? { pods: 0, games: 0, wins: 0, winTurnSum: 0, winTurnWins: 0 };
      const wins = results.wins[name] ?? 0;
      const avgTurn = results.avgWinTurn[name];
      entry.pods += 1;
      entry.games += results.gamesPlayed;
      entry.wins += wins;
      if (wins > 0 && typeof avgTurn === 'number' && avgTurn > 0) {
        entry.winTurnSum += avgTurn * wins;
        entry.winTurnWins += wins;
      }
      totals.set(name, entry);
    }
  }

  return [...totals.entries()]
    .map(([name, t]) => ({
      name,
      pods: t.pods,
      gamesPlayed: t.games,
      wins: t.wins,
      winRate: t.games > 0 ? t.wins / t.games : 0,
      avgWinTurn: t.winTurnWins > 0 ? t.winTurnSum / t.winTurnWins : null,
    }))
    .sort((a, b) => b.winRate - a.winRate || b.wins - a.wins || a.name.localeCompare(b.name));
}
