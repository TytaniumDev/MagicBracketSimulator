/**
 * =============================================================================
 * Forge Log Analyzer - Condensing Pipeline
 * =============================================================================
 *
 * This is the MAIN ENTRY POINT for the log condensing pipeline.
 *
 * ## Pipeline Overview
 *
 * The condensing pipeline transforms a raw Forge game log (~10-100KB of text)
 * into a structured JSON summary (~1-5KB) suitable for AI analysis.
 *
 * ```
 * Raw Log (string)
 *    │
 *    ▼
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ STEP 1: SPLIT & FILTER (filter.ts)                                     │
 * │   - Split into lines                                                   │
 * │   - Remove noise (priority passes, phase markers, empty lines)         │
 * │   - Special case: Keep draw step if extra cards drawn                  │
 * └─────────────────────────────────────────────────────────────────────────┘
 *    │
 *    ▼
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ STEP 2: CLASSIFY (classify.ts)                                         │
 * │   - Categorize each line into an event type                            │
 * │   - Priority: win > life > zone_change > high_cmc > commander > ...    │
 * │   - Discard lines that don't match any "keep" pattern                  │
 * └─────────────────────────────────────────────────────────────────────────┘
 *    │
 *    ▼
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ STEP 3: EXTRACT TURNS & METRICS (turns.ts)                             │
 * │   - Find turn boundaries ("Turn N: Player X")                          │
 * │   - Calculate mana events per turn                                     │
 * │   - Calculate cards drawn per turn                                     │
 * │   - Detect winner and winning turn                                     │
 * └─────────────────────────────────────────────────────────────────────────┘
 *    │
 *    ▼
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ STEP 4: BUILD CONDENSED OUTPUT                                         │
 * │   - Assemble all pieces into CondensedGame object                      │
 * │   - This is what gets sent to the Analysis Service                     │
 * └─────────────────────────────────────────────────────────────────────────┘
 *    │
 *    ▼
 * Condensed Game (CondensedGame)
 * ```
 *
 * ## Usage
 *
 * ```typescript
 * import { condenseGame, condenseGames } from './condenser';
 *
 * // Single game
 * const condensed = condenseGame(rawLogString);
 *
 * // Multiple games
 * const allCondensed = condenseGames(arrayOfRawLogs);
 * ```
 *
 * =============================================================================
 */

import type { CondensedGame, StructuredGame } from '../types';
import { splitAndFilter } from './filter';
import { classifyLines } from './classify';
import {
  extractTurnRanges,
  getNumPlayers,
  getMaxRound,
  calculateManaPerTurn,
  calculateCardsDrawnPerTurn,
  extractWinner,
  extractWinningTurn,
} from './turns';
import { buildStructuredGame } from './structured';

// Re-export sub-modules for direct access if needed
export { shouldIgnoreLine, filterLines, splitAndFilter } from './filter';
export { classifyLine, createEvent, classifyLines } from './classify';
export * from './turns';
export * from './structured';
export * from './patterns';

// -----------------------------------------------------------------------------
// Main Condensing Functions
// -----------------------------------------------------------------------------

/**
 * Condenses a single raw game log into a structured summary.
 *
 * This is the main entry point for converting a Forge log into the
 * format expected by the Analysis Service.
 *
 * @param rawLog - The complete raw log text for one game
 * @returns A CondensedGame object with significant events and metrics
 *
 * @example
 * const rawLog = fs.readFileSync('game_1.txt', 'utf-8');
 * const condensed = condenseGame(rawLog);
 * console.log(`Game had ${condensed.turnCount} turns`);
 * console.log(`Winner: ${condensed.winner}`);
 */
export function condenseGame(rawLog: string): CondensedGame {
  // ===========================================================================
  // STEP 1: FILTER
  // ===========================================================================
  // Remove noise lines (priority passes, phase markers, etc.)
  // This typically reduces log size by ~80%.

  const filteredLines = splitAndFilter(rawLog);

  // ===========================================================================
  // STEP 2: CLASSIFY
  // ===========================================================================
  // Categorize remaining lines into event types (life_change, spell_cast, etc.)
  // Lines that don't match any pattern are discarded here.

  const keptEvents = classifyLines(filteredLines);

  // ===========================================================================
  // STEP 3: EXTRACT METRICS (round-based)
  // ===========================================================================
  // Calculate per-round statistics from the ORIGINAL log (not filtered).
  // We use the original because metric patterns (mana, draw) may appear
  // in lines that were filtered for event purposes.
  //
  // A "round" is one full rotation where each player takes a turn.
  // In a 4-player Commander game, round 1 = segments 1-4, round 2 = segments 5-8, etc.

  const turnRanges = extractTurnRanges(rawLog);
  const numPlayers = getNumPlayers(turnRanges);
  const turnCount = getMaxRound(turnRanges, numPlayers);
  const manaPerTurn = calculateManaPerTurn(rawLog, numPlayers);
  const cardsDrawnPerTurn = calculateCardsDrawnPerTurn(rawLog, numPlayers);

  // ===========================================================================
  // STEP 4: DETECT WINNER
  // ===========================================================================
  // Try to determine who won and when (round-based).

  const winner = extractWinner(rawLog);
  const winningTurn = extractWinningTurn(rawLog);

  // ===========================================================================
  // STEP 5: BUILD OUTPUT
  // ===========================================================================
  // Assemble all pieces into the final CondensedGame structure.

  const condensed: CondensedGame = {
    keptEvents,
    manaPerTurn,
    cardsDrawnPerTurn,
    turnCount,
  };

  // Only include optional fields if we found values
  if (winner !== undefined) {
    condensed.winner = winner;
  }
  if (winningTurn !== undefined) {
    condensed.winningTurn = winningTurn;
  }

  return condensed;
}

/**
 * Condenses multiple game logs.
 *
 * Convenience wrapper for processing an array of games.
 *
 * @param rawLogs - Array of raw log strings (one per game)
 * @returns Array of CondensedGame objects
 *
 * @example
 * const allLogs = ['log1...', 'log2...', 'log3...'];
 * const condensed = condenseGames(allLogs);
 * // condensed.length === 3
 */
export function condenseGames(rawLogs: string[]): CondensedGame[] {
  return rawLogs.map((log) => condenseGame(log));
}

/**
 * Builds structured game data for frontend visualization.
 *
 * This creates a per-deck, per-turn breakdown of the game for the
 * 4-column visualization UI.
 *
 * @param rawLog - The complete raw log text for one game
 * @param deckNames - Optional deck names [hero, opp1, opp2, opp3]
 * @returns StructuredGame object
 */
export function structureGame(
  rawLog: string,
  deckNames?: string[]
): StructuredGame {
  return buildStructuredGame(rawLog, deckNames);
}

/**
 * Structures multiple game logs.
 *
 * @param rawLogs - Array of raw log strings
 * @param deckNames - Optional deck names
 * @returns Array of StructuredGame objects
 */
export function structureGames(
  rawLogs: string[],
  deckNames?: string[]
): StructuredGame[] {
  return rawLogs.map((log) => buildStructuredGame(log, deckNames));
}

// -----------------------------------------------------------------------------
// Utility: Convert Condensed to Analysis Service Format
// -----------------------------------------------------------------------------

/**
 * Converts our CondensedGame format to the format expected by the
 * Analysis Service (Python).
 *
 * The Analysis Service uses snake_case keys (Python convention), while
 * we use camelCase (TypeScript convention). This function bridges the gap.
 *
 * @param condensed - A CondensedGame object
 * @returns Object with snake_case keys for Analysis Service
 */
export function toAnalysisServiceFormat(condensed: CondensedGame): object {
  return {
    kept_events: condensed.keptEvents.map((e) => ({
      type: e.type,
      line: e.line,
      ...(e.turn !== undefined && { turn: e.turn }),
      ...(e.player !== undefined && { player: e.player }),
    })),
    mana_per_turn: Object.fromEntries(
      Object.entries(condensed.manaPerTurn).map(([k, v]) => [
        k,
        { mana_events: v.manaEvents },
      ])
    ),
    cards_drawn_per_turn: condensed.cardsDrawnPerTurn,
    turn_count: condensed.turnCount,
    ...(condensed.winner && { winner: condensed.winner }),
    ...(condensed.winningTurn && { winning_turn: condensed.winningTurn }),
  };
}

/**
 * Converts multiple condensed games to Analysis Service format.
 *
 * @param condensed - Array of CondensedGame objects
 * @returns Array of objects for Analysis Service
 */
export function toAnalysisServiceFormatBatch(condensed: CondensedGame[]): object[] {
  return condensed.map(toAnalysisServiceFormat);
}
