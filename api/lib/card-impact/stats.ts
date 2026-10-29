/**
 * Per-deck card impact counters, and the scores derived from them.
 *
 * Counters are plain sums so a finished job can be added to a deck's stats
 * with one read-modify-write of one document (see card-stats-store.ts),
 * which keeps Firestore usage at a few writes per job.
 *
 * Turn-indexed arrays use TURN_BINS bins: index 0..14 is the deck's own
 * turn 1..15, index 15 is "16+".
 *
 * Scores compare each card against the same deck at the same turn, so a
 * card that's simply cast late (when games are nearly decided) isn't
 * mistaken for a game-winner:
 *   winLift   — how much more often the deck wins after casting it.
 *   closeLift — how much more often the deck wins within CLOSE_WINDOW of
 *               its own turns after casting it (the "game ends fast and
 *               lopsided" signal).
 */
import type { CardImpact, DeckCardStats } from '@shared/types/card-impact';
import type { GameCardSummary } from './parse';

export const TURN_BINS = 16;
/** A win counts as "closing" when it comes within this many of the deck's own turns, counting the cast turn. */
export const CLOSE_WINDOW = 3;

export type { DeckCardStats };

/**
 * Bump when parse.ts changes what it counts. Stored counters from an older
 * version are dropped, and the admin backfill rebuilds them from raw logs.
 * 2: cards put onto the battlefield without being cast count too.
 */
export const CARD_STATS_VERSION = 2;

export function emptyDeckCardStats(): DeckCardStats {
  return {
    games: 0,
    wins: 0,
    aliveAt: new Array(TURN_BINS).fill(0),
    winsFromAlive: new Array(TURN_BINS).fill(0),
    closesFromAlive: new Array(TURN_BINS).fill(0),
    cards: {},
    jobIds: [],
    version: CARD_STATS_VERSION,
  };
}

/** Stored counters if they were built by the current parser, else null. */
export function currentDeckCardStats(stored: DeckCardStats | null | undefined): DeckCardStats | null {
  return stored && stored.version === CARD_STATS_VERSION ? stored : null;
}

function bin(turn: number): number {
  return Math.min(Math.max(turn, 1), TURN_BINS) - 1;
}

/**
 * Add one game, seen from `player`'s seat, to a deck's counters. Mutates
 * and returns `stats`.
 */
export function addGame(stats: DeckCardStats, game: GameCardSummary, player: string): DeckCardStats {
  const turns = game.turnsTaken[player] ?? 0;
  if (turns === 0) return stats;

  const won = game.winner === player;
  const closes = (fromTurn: number) => won && turns - fromTurn < CLOSE_WINDOW;

  stats.games++;
  if (won) stats.wins++;

  // Every turn the deck reached. 16+ collapses into the last bin, once.
  for (let t = 1; t <= Math.min(turns, TURN_BINS); t++) {
    const i = t - 1;
    stats.aliveAt[i]++;
    if (won) stats.winsFromAlive[i]++;
    if (closes(t)) stats.closesFromAlive[i]++;
  }

  for (const play of game.plays) {
    if (play.player !== player) continue;
    const card = (stats.cards[play.name] ??= {
      cast: 0,
      castAt: new Array(TURN_BINS).fill(0),
      winsAt: new Array(TURN_BINS).fill(0),
      closesAt: new Array(TURN_BINS).fill(0),
      damageToPlayers: 0,
      leftBattlefield: 0,
      targetedByOpponents: 0,
    });
    const i = bin(play.turn);
    card.cast++;
    card.castAt[i]++;
    if (won) card.winsAt[i]++;
    if (closes(play.turn)) card.closesAt[i]++;
    card.damageToPlayers += play.damageToPlayers;
    if (play.leftBattlefield) card.leftBattlefield++;
    card.targetedByOpponents += play.targetedByOpponents;
  }

  return stats;
}

/** Observed minus expected, per cast, where expected uses the deck's own rate at each cast turn. */
function lift(observedAt: number[], castAt: number[], baseline: number[], aliveAt: number[]): number {
  let observed = 0;
  let expected = 0;
  let casts = 0;
  for (let i = 0; i < TURN_BINS; i++) {
    if (castAt[i] === 0) continue;
    observed += observedAt[i];
    casts += castAt[i];
    expected += aliveAt[i] > 0 ? (castAt[i] * baseline[i]) / aliveAt[i] : 0;
  }
  return casts > 0 ? (observed - expected) / casts : 0;
}

/** Score every card the deck has cast, highest closeLift first. */
export function scoreCards(stats: DeckCardStats): CardImpact[] {
  return Object.entries(stats.cards)
    .map(([name, c]): CardImpact => {
      const castTurnSum = c.castAt.reduce((sum, n, i) => sum + n * (i + 1), 0);
      return {
        name,
        cast: c.cast,
        castRate: stats.games > 0 ? c.cast / stats.games : 0,
        avgCastTurn: c.cast > 0 ? castTurnSum / c.cast : 0,
        winRateWhenCast: c.cast > 0 ? c.winsAt.reduce((a, b) => a + b, 0) / c.cast : 0,
        winLift: lift(c.winsAt, c.castAt, stats.winsFromAlive, stats.aliveAt),
        closeLift: lift(c.closesAt, c.castAt, stats.closesFromAlive, stats.aliveAt),
        avgDamageToPlayers: c.cast > 0 ? c.damageToPlayers / c.cast : 0,
        leftBattlefieldRate: c.cast > 0 ? c.leftBattlefield / c.cast : 0,
        targetedRate: c.cast > 0 ? c.targetedByOpponents / c.cast : 0,
      };
    })
    .sort((a, b) => b.closeLift - a.closeLift);
}
