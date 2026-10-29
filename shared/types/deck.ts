/**
 * Deck detail types shared by the API (`GET /api/decks/:id`) and the
 * frontend deck page.
 */

/** One line of a decklist: how many copies of which card. */
export interface DeckCard {
  quantity: number;
  /** Card name without set/collector suffix (e.g. "Sol Ring", not "Sol Ring|C21|263"). */
  name: string;
}

/** A deck's results across every recorded game. Null when it has never played. */
export interface DeckStats {
  /** Bayesian-adjusted win rate as a percentage (same score as the leaderboard). */
  rating: number;
  gamesPlayed: number;
  wins: number;
  winRate: number;
  /** Mean winning turn across resolved wins. Null when no win has a recorded turn. */
  avgWinTurn: number | null;
  /** 16 bins — indexes 0..14 map to turns 1..15, index 15 is "16+". Null when no data. */
  winTurnHistogram: number[] | null;
}

export interface DeckDetail {
  id: string;
  name: string;
  primaryCommander: string | null;
  colorIdentity: string[];
  isPrecon: boolean;
  setName: string | null;
  link: string | null;
}

export interface DeckDetailResponse {
  deck: DeckDetail;
  /**
   * False when the deck is no longer in the deck library (e.g. a precon the
   * Archidekt sync removed) but its results remain. The lists are then empty.
   */
  decklistAvailable: boolean;
  commanders: DeckCard[];
  /** Main deck, in decklist order. */
  cards: DeckCard[];
  stats: DeckStats | null;
}
