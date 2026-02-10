export interface GameEvent {
  type: string;
  line: string;
  turn?: number;
  player?: string;
}

export interface CondensedGame {
  keptEvents: GameEvent[];
  manaPerTurn: Record<string, { manaEvents: number }>;
  cardsDrawnPerTurn: Record<string, number>;
  turnCount: number;
  winner?: string;
  winningTurn?: number;
}

export interface DeckAction {
  line: string;
  eventType?: string;
}

export interface DeckTurnActions {
  turnNumber: number;
  actions: DeckAction[];
}

export interface DeckHistory {
  deckLabel: string;
  turns: DeckTurnActions[];
}

export interface StructuredGame {
  totalTurns: number;
  players: string[];
  decks: DeckHistory[];
  lifePerTurn?: Record<number, Record<string, number>>;
  winner?: string;
  winningTurn?: number;
}

export type LogViewTab = 'raw' | 'condensed';
