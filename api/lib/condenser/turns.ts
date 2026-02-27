/**
 * =============================================================================
 * Forge Log Analyzer - Turn Extraction & Metrics
 * =============================================================================
 *
 * This module handles turn-related operations:
 *   1. Finding turn boundaries in the log
 *   2. Calculating per-turn metrics (mana, card draw)
 *   3. Determining the winner and winning turn
 *
 * ## Forge Turn Format
 *
 * Forge marks turns at the start of a line. There are two known formats:
 *
 * ### Format 1 (older):
 *   - "Turn 1: Player A"
 *   - "Turn 1: Player B"
 *   - "Turn 2: Player A"
 *
 * ### Format 2 (current):
 *   - "Turn: Turn 1 (Ai(4)-Draconic Dissent)"
 *   - "Turn: Turn 2 (Ai(1)-Doran Big Butts)"
 *
 * In Commander (4-player), each game turn has one player turn per player.
 * We track both the turn NUMBER and the active PLAYER.
 *
 * =============================================================================
 */

import type { TurnManaInfo, DeckTurnInfo } from '../types';
import {
  EXTRACT_TURN_NUMBER,
  EXTRACT_MANA_PRODUCED,
  EXTRACT_TAP_FOR,
  EXTRACT_DRAW_MULTIPLE,
  EXTRACT_DRAW_SINGLE,
  EXTRACT_WINNER,
  EXTRACT_ACTIVE_PLAYER,
} from './patterns';
import { matchesDeckName } from './deck-match';

// -----------------------------------------------------------------------------
// Turn Boundary Types
// -----------------------------------------------------------------------------

/**
 * Represents a turn boundary in the log.
 * Used to slice the log into per-turn chunks for metric calculation.
 */
export interface TurnRange {
  /** The turn number (1, 2, 3, ...) */
  turnNumber: number;
  /** Character offset where this turn starts in the raw log */
  startOffset: number;
  /** The active player for this turn segment (if parseable) */
  player?: string;
}

// -----------------------------------------------------------------------------
// Turn Extraction
// -----------------------------------------------------------------------------

/**
 * Finds all turn boundaries in a raw log.
 *
 * Returns a list of TurnRange objects, each marking where a new turn
 * (or player turn within a game turn) begins.
 *
 * @param rawLog - The complete raw log text
 * @returns Array of turn ranges, sorted by position in the log
 *
 * @example
 * // Format 1 (older):
 * const log1 = "Turn 1: Player A\n...stuff...\nTurn 2: Player A\n...more...";
 * const ranges1 = extractTurnRanges(log1);
 * // Result: [
 * //   { turnNumber: 1, startOffset: 0, player: "Player A" },
 * //   { turnNumber: 2, startOffset: 25, player: "Player A" }
 * // ]
 *
 * // Format 2 (current):
 * const log2 = "Turn: Turn 1 (Ai(4)-Draconic)\n...stuff...\nTurn: Turn 2 (Ai(1)-Doran)\n...";
 * const ranges2 = extractTurnRanges(log2);
 * // Result: [
 * //   { turnNumber: 1, startOffset: 0, player: "Ai(4)-Draconic" },
 * //   { turnNumber: 2, startOffset: 30, player: "Ai(1)-Doran" }
 * // ]
 */
export function extractTurnRanges(rawLog: string): TurnRange[] {
  const ranges: TurnRange[] = [];

  // Normalize line endings so ^ in multiline mode matches at start of each line.
  // Windows (\r\n) or old Mac (\r) would leave \r before "Turn:", so ^Turn never matches.
  const normalized = rawLog.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // -------------------------------------------------------------------------
  // Step 1: Find all "Turn N" occurrences using regex
  // -------------------------------------------------------------------------
  // We use the global flag (g) to find all matches, not just the first.
  // The exec() method in a loop gives us match positions.

  const pattern = new RegExp(EXTRACT_TURN_NUMBER.source, 'gim');

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(normalized)) !== null) {
    const turnNumber = parseInt(match[1], 10);
    const startOffset = match.index;

    // -----------------------------------------------------------------------
    // Step 2: Extract the active player from this line
    // -----------------------------------------------------------------------
    // The turn line format is "Turn N: Player X". We extract "Player X".
    // This requires looking at the full line, not just the "Turn N" match.

    // Find the end of this line (use normalized so offsets are consistent)
    const lineEnd = normalized.indexOf('\n', startOffset);
    const fullLine =
      lineEnd === -1
        ? normalized.slice(startOffset)
        : normalized.slice(startOffset, lineEnd);

    // Extract player from turn line
    // Format 1: "Turn N: Player X" → group 1
    // Format 2: "Turn: Turn N (PlayerName)" → group 2
    const playerMatch = EXTRACT_ACTIVE_PLAYER.exec(fullLine);
    const player = (playerMatch?.[1] ?? playerMatch?.[2])?.trim();

    ranges.push({
      turnNumber,
      startOffset,
      player,
    });
  }

  return ranges;
}

/**
 * Gets the maximum turn number from a list of turn ranges.
 *
 * @param ranges - Array of turn ranges
 * @returns The highest turn number, or 0 if no turns found
 */
export function getMaxTurn(ranges: TurnRange[]): number {
  if (ranges.length === 0) {
    return 0;
  }
  return Math.max(...ranges.map((r) => r.turnNumber));
}

// -----------------------------------------------------------------------------
// Round-based Helpers (Turn = one full rotation of all players)
// -----------------------------------------------------------------------------

/**
 * Determines the number of players in the game from turn ranges.
 *
 * In Commander (4-player), each game turn has one segment per player.
 * We count unique players from the first few ranges to determine player count.
 *
 * @param ranges - Array of turn ranges
 * @returns Number of players (defaults to 4 for Commander)
 */
export function getNumPlayers(ranges: TurnRange[]): number {
  if (ranges.length === 0) {
    return 4; // Default to Commander 4-player
  }

  // Count unique players from turn ranges
  const uniquePlayers = new Set<string>();
  for (const range of ranges) {
    if (range.player) {
      uniquePlayers.add(range.player);
    }
  }

  // Return the count, defaulting to 4 if we couldn't find players
  return uniquePlayers.size > 0 ? uniquePlayers.size : 4;
}

/**
 * Converts a segment index (Forge's sequential turn number) to a round number.
 *
 * In a 4-player game:
 *   - Segments 1-4 → Round 1
 *   - Segments 5-8 → Round 2
 *   - etc.
 *
 * @param segmentIndex - The segment/turn number from Forge (1-based)
 * @param numPlayers - Number of players in the game
 * @returns The round number (1-based)
 */
export function segmentToRound(segmentIndex: number, numPlayers: number): number {
  if (segmentIndex <= 0 || numPlayers <= 0) {
    return 1;
  }
  return Math.ceil(segmentIndex / numPlayers);
}

/**
 * Gets the maximum round number from turn ranges.
 *
 * @param ranges - Array of turn ranges
 * @param numPlayers - Number of players in the game
 * @returns The highest round number, or 0 if no turns found
 */
export function getMaxRound(ranges: TurnRange[], numPlayers: number): number {
  const maxTurn = getMaxTurn(ranges);
  if (maxTurn === 0) {
    return 0;
  }
  return segmentToRound(maxTurn, numPlayers);
}

// -----------------------------------------------------------------------------
// Per-Deck Turn Counting
// -----------------------------------------------------------------------------

/**
 * Counts how many turns each deck/player actually took in the game.
 *
 * Unlike segmentToRound() which divides by player count, this correctly
 * handles player eliminations: when a player is eliminated mid-game, the
 * remaining players continue taking turns but the segments-per-round shrinks.
 * Counting per-player appearances in the turn sequence gives accurate counts.
 *
 * @param ranges - Turn ranges from extractTurnRanges()
 * @returns Map of player name -> { turnsTaken, lastSegment }
 */
export function calculatePerDeckTurns(ranges: TurnRange[]): Record<string, DeckTurnInfo> {
  const result: Record<string, DeckTurnInfo> = {};

  for (const range of ranges) {
    if (!range.player) continue;

    if (!result[range.player]) {
      result[range.player] = { turnsTaken: 0, lastSegment: 0 };
    }
    result[range.player].turnsTaken++;
    result[range.player].lastSegment = range.turnNumber;
  }

  return result;
}

/**
 * Slices the raw log into per-turn chunks.
 *
 * Each chunk contains all the log text from one "Turn N:" line
 * to the next (or end of log).
 *
 * @param rawLog - The complete raw log text
 * @param ranges - Turn ranges from extractTurnRanges()
 * @returns Array of { turnNumber, chunk } objects
 */
export function sliceByTurn(
  rawLog: string,
  ranges: TurnRange[]
): { turnNumber: number; player?: string; chunk: string }[] {
  const chunks: { turnNumber: number; player?: string; chunk: string }[] = [];

  for (let i = 0; i < ranges.length; i++) {
    const current = ranges[i];
    const nextStart = i + 1 < ranges.length ? ranges[i + 1].startOffset : rawLog.length;
    const chunk = rawLog.slice(current.startOffset, nextStart);

    chunks.push({
      turnNumber: current.turnNumber,
      player: current.player,
      chunk,
    });
  }

  return chunks;
}

// -----------------------------------------------------------------------------
// Mana Metrics
// -----------------------------------------------------------------------------

/**
 * Counts mana production events in a text chunk.
 *
 * We look for patterns like:
 *   - "adds {G} to mana pool"
 *   - "produces 2 mana"
 *   - "tap Sol Ring for 2 mana"
 *
 * This is a HEURISTIC - Forge log formats vary and we can't catch everything.
 * But it gives a rough idea of mana development per turn.
 *
 * @param chunk - A portion of the log (typically one turn's worth)
 * @returns Count of mana-producing events detected
 */
export function countManaEvents(chunk: string): number {
  // Count matches of the main mana pattern
  const manaMatches = chunk.match(new RegExp(EXTRACT_MANA_PRODUCED.source, 'gi'));
  const manaCount = manaMatches?.length ?? 0;

  // Also count "tap X for Y" patterns (additional mana detection)
  const tapMatches = chunk.match(new RegExp(EXTRACT_TAP_FOR.source, 'gi'));
  const tapCount = tapMatches?.length ?? 0;

  // Combine counts (may have some overlap, but better to over-count than miss)
  return manaCount + tapCount;
}

/**
 * Calculates mana events per round for the entire log.
 *
 * A "round" is one full rotation where each player takes a turn.
 * In a 4-player Commander game, round 1 = segments 1-4, round 2 = segments 5-8, etc.
 *
 * @param rawLog - The complete raw log text
 * @param numPlayers - Optional number of players (auto-detected if not provided)
 * @returns Object mapping round number -> mana info
 *
 * @example
 * const mana = calculateManaPerTurn(log);
 * // Result: { 1: { manaEvents: 8 }, 2: { manaEvents: 12 }, ... }
 */
export function calculateManaPerTurn(
  rawLog: string,
  numPlayers?: number
): Record<number, TurnManaInfo> {
  const normalized = rawLog.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const ranges = extractTurnRanges(normalized);
  const chunks = sliceByTurn(normalized, ranges);
  const playerCount = numPlayers ?? getNumPlayers(ranges);
  const result: Record<number, TurnManaInfo> = {};

  // -------------------------------------------------------------------------
  // Aggregate mana events by ROUND (all player segments in a round)
  // -------------------------------------------------------------------------
  // In Commander, round 1 has 4 player-turn segments. We sum them all
  // into a single "round 1" entry.

  for (const { turnNumber, chunk } of chunks) {
    const round = segmentToRound(turnNumber, playerCount);
    const manaEvents = countManaEvents(chunk);

    if (result[round]) {
      // Add to existing round
      result[round].manaEvents += manaEvents;
    } else {
      // First segment for this round
      result[round] = { manaEvents };
    }
  }

  return result;
}

// -----------------------------------------------------------------------------
// Card Draw Metrics
// -----------------------------------------------------------------------------

/**
 * Counts cards drawn in a text chunk.
 *
 * Patterns detected:
 *   - "draws a card" -> 1 card
 *   - "draws 3 cards" -> 3 cards
 *
 * Note: Normal draw step is often filtered out by IGNORE patterns.
 * This primarily catches extra draw effects.
 *
 * @param chunk - A portion of the log
 * @returns Total number of cards drawn
 */
export function countCardsDrawn(chunk: string): number {
  let total = 0;

  // -------------------------------------------------------------------------
  // Count "draws N cards" patterns (multiple cards)
  // -------------------------------------------------------------------------
  const multiplePattern = new RegExp(EXTRACT_DRAW_MULTIPLE.source, 'gi');
  let multiMatch: RegExpExecArray | null;
  while ((multiMatch = multiplePattern.exec(chunk)) !== null) {
    const count = parseInt(multiMatch[1], 10);
    if (!isNaN(count)) {
      total += count;
    }
  }

  // -------------------------------------------------------------------------
  // Count "draws a card" patterns (single card)
  // -------------------------------------------------------------------------
  // We use a negative lookahead (?!s) in the pattern to avoid matching
  // "draws 3 cards" again (already counted above).
  const singleMatches = chunk.match(new RegExp(EXTRACT_DRAW_SINGLE.source, 'gi'));
  total += singleMatches?.length ?? 0;

  return total;
}

/**
 * Calculates cards drawn per round for the entire log.
 *
 * A "round" is one full rotation where each player takes a turn.
 * In a 4-player Commander game, round 1 = segments 1-4, round 2 = segments 5-8, etc.
 *
 * @param rawLog - The complete raw log text
 * @param numPlayers - Optional number of players (auto-detected if not provided)
 * @returns Object mapping round number -> cards drawn
 */
export function calculateCardsDrawnPerTurn(
  rawLog: string,
  numPlayers?: number
): Record<number, number> {
  const normalized = rawLog.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const ranges = extractTurnRanges(normalized);
  const chunks = sliceByTurn(normalized, ranges);
  const playerCount = numPlayers ?? getNumPlayers(ranges);
  const result: Record<number, number> = {};

  for (const { turnNumber, chunk } of chunks) {
    const round = segmentToRound(turnNumber, playerCount);
    const cardsDrawn = countCardsDrawn(chunk);

    if (result[round]) {
      result[round] += cardsDrawn;
    } else {
      result[round] = cardsDrawn;
    }
  }

  return result;
}

// -----------------------------------------------------------------------------
// Winner Detection
// -----------------------------------------------------------------------------

/**
 * Attempts to extract the game winner from the log.
 *
 * Looks for patterns like:
 *   - "Player A wins the game."
 *   - "Game Over. Player B wins."
 *
 * @param rawLog - The complete raw log text
 * @returns The winner's identifier, or undefined if not found
 */
export function extractWinner(rawLog: string): string | undefined {
  const match = EXTRACT_WINNER.exec(rawLog);
  return match?.[1]?.trim().replace(/^Game outcome:\s*/i, '');
}

/**
 * Determines the winning turn as the winner's personal turn count.
 *
 * Uses per-deck turn counting to find how many turns the winner actually took,
 * which is accurate even when players are eliminated mid-game (shrinking the
 * segments-per-round). Falls back to the max turn count across all decks if
 * no winner is found, and to round-based calculation as a last resort.
 *
 * @param rawLog - The complete raw log text
 * @returns The winner's personal turn count, or undefined if not determinable
 */
export function extractWinningTurn(rawLog: string): number | undefined {
  const ranges = extractTurnRanges(rawLog);
  if (ranges.length === 0) {
    return undefined;
  }

  const perDeck = calculatePerDeckTurns(ranges);
  const winner = extractWinner(rawLog);

  // Try to find the winner's personal turn count
  if (winner) {
    const winnerKey = Object.keys(perDeck).find(
      (k) => matchesDeckName(k, winner)
    );
    if (winnerKey) {
      return perDeck[winnerKey].turnsTaken;
    }
  }

  // Fallback: max turns across all decks
  const allTurns = Object.values(perDeck);
  if (allTurns.length > 0) {
    return Math.max(...allTurns.map((d) => d.turnsTaken));
  }

  // Last resort: round-based
  const numPlayers = getNumPlayers(ranges);
  return getMaxRound(ranges, numPlayers);
}

// -----------------------------------------------------------------------------
// Life Total Tracking
// -----------------------------------------------------------------------------

/**
 * Pattern for Forge's native life change log entries.
 *
 * Forge (since the version after 2.0.10) outputs explicit life changes as:
 *   [LIFE] Life: PlayerName oldValue -> newValue
 *
 * Examples:
 *   [LIFE] Life: Ai(1)-Doran Big Butts 40 -> 37
 *   [LIFE] Life: Ai(2)-Enduring Enchantments 37 -> 0
 *
 * Capture groups:
 *   1: Player name (e.g., "Ai(1)-Doran Big Butts")
 *   2: Old life total
 *   3: New life total
 */
const LIFE_LOG_PATTERN = /^\[LIFE\] Life: (.+?)\s+(-?\d+)\s*->\s*(-?\d+)/;

/**
 * Calculates life totals per round for all players.
 *
 * Parses Forge's native `[LIFE] Life: PlayerName oldValue -> newValue` log
 * entries to track absolute life totals. This gives us exact values directly
 * from the game engine — no heuristic inference needed.
 *
 * A "round" is one full rotation where each player takes a turn.
 * In a 4-player Commander game, round 1 = segments 1-4, round 2 = segments 5-8, etc.
 *
 * Commander format starts at 40 life. Players whose life hasn't changed yet
 * remain at 40 until a `[LIFE]` entry updates them.
 *
 * @param rawLog - The complete raw log text
 * @param players - Array of player identifiers (e.g., ["Ai(1)-Doran Big Butts", ...])
 * @param numPlayers - Number of players in the game (optional, auto-detected if not provided)
 * @returns Map of round number -> map of player name -> life total at end of round
 */
export function calculateLifePerTurn(
  rawLog: string,
  players: string[],
  numPlayers?: number
): Record<number, Record<string, number>> {
  const normalized = rawLog.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const ranges = extractTurnRanges(normalized);
  const chunks = sliceByTurn(normalized, ranges);
  const playerCount = numPlayers ?? getNumPlayers(ranges);

  // Initialize life totals (Commander starts at 40)
  const currentLife: Record<string, number> = {};
  for (const player of players) {
    currentLife[player] = 40;
  }

  const lifePerRound: Record<number, Record<string, number>> = {};

  // Group segments by round
  const roundGroups = new Map<number, typeof chunks>();
  for (const chunk of chunks) {
    const round = segmentToRound(chunk.turnNumber, playerCount);
    if (!roundGroups.has(round)) {
      roundGroups.set(round, []);
    }
    roundGroups.get(round)!.push(chunk);
  }

  // Process each round in order and snapshot at end of each round
  const sortedRounds = Array.from(roundGroups.keys()).sort((a, b) => a - b);

  for (const round of sortedRounds) {
    const roundChunks = roundGroups.get(round)!;

    for (const { chunk } of roundChunks) {
      for (const line of chunk.split('\n')) {
        const match = LIFE_LOG_PATTERN.exec(line);
        if (!match) continue;

        const logName = match[1];
        const newLife = parseInt(match[3], 10);

        // Match the player name from the [LIFE] entry to our known players list
        const player = players.find(
          (p) => p === logName || p.startsWith(logName) || logName.startsWith(p)
        );
        if (player) {
          currentLife[player] = newLife;
        }
      }
    }

    // Snapshot life totals at end of this round
    lifePerRound[round] = { ...currentLife };
  }

  return lifePerRound;
}
