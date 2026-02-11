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

export type LogViewTab = 'raw' | 'condensed';
