/**
 * Card impact stats: how each card in a deck moves its games.
 * Counters are stored per deck (api/lib/card-impact/stats.ts); scores are
 * derived from them when the deck page asks.
 */

/** Sums for one card across every game its deck played. Turn arrays have 16 bins (turn 1..15, 16+). */
export interface CardCounters {
  /** Games in which the deck cast or played it at least once. */
  cast: number;
  /** Games by the deck's own turn of first cast. */
  castAt: number[];
  /** Of those, games the deck went on to win. */
  winsAt: number[];
  /** Of those, games the deck won within 3 of its own turns from the cast. */
  closesAt: number[];
  damageToPlayers: number;
  /** Games in which it went to a graveyard or exile from the battlefield. */
  leftBattlefield: number;
  /** Opponent spells that targeted it. */
  targetedByOpponents: number;
}

/** One deck's card impact counters. */
export interface DeckCardStats {
  games: number;
  wins: number;
  /** Games in which the deck reached its own turn t. */
  aliveAt: number[];
  /** Of those, games the deck won. */
  winsFromAlive: number[];
  /** Of those, games the deck won within 3 of its own turns from t. */
  closesFromAlive: number[];
  cards: Record<string, CardCounters>;
  /** Jobs already counted, so re-running aggregation can't double count. */
  jobIds: string[];
}

/** One card's scores, for the deck page. */
export interface CardImpact {
  name: string;
  /** Games in which it was cast. */
  cast: number;
  /** Share of the deck's games in which it was cast. */
  castRate: number;
  avgCastTurn: number;
  winRateWhenCast: number;
  /** Win rate after casting it, minus the deck's win rate from the same turn. -1..1. */
  winLift: number;
  /** Rate of winning within 3 turns of casting it, minus the deck's rate from the same turn. -1..1. */
  closeLift: number;
  avgDamageToPlayers: number;
  /** Share of casts where it later left the battlefield (died, sacrificed or exiled). */
  leftBattlefieldRate: number;
  /** Opponent spells targeting it, per cast. */
  targetedRate: number;
}

export interface DeckCardImpactResponse {
  /** Games the counters cover. Older games (Forge 2.0.10 logs) lack leave-the-battlefield data. */
  games: number;
  cards: CardImpact[];
}
