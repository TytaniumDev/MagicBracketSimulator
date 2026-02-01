/**
 * =============================================================================
 * Forge Log Analyzer - Structured Output Generation
 * =============================================================================
 *
 * This module creates structured, per-deck/per-turn representations of the
 * game log for frontend visualization.
 *
 * ## Purpose
 *
 * The frontend wants to show a 4-column layout where each deck's actions
 * are visible by turn. This requires organizing the log by:
 *   1. Turn number (1, 2, 3, ...)
 *   2. Player/deck (Hero, Opponent 1, Opponent 2, Opponent 3)
 *
 * ## Forge Log Structure
 *
 * Forge outputs interleaved player turns:
 *   Turn 1: Player A
 *   Player A plays Forest.
 *   Player A casts Sol Ring.
 *   Turn 1: Player B
 *   Player B plays Island.
 *   ...
 *
 * We need to attribute each line to the "current player" based on the
 * most recent "Turn N: Player X" line.
 *
 * =============================================================================
 */

import type { StructuredGame, DeckHistory, DeckTurnActions, DeckAction, EventType } from '../types.js';
import { extractTurnRanges, sliceByTurn, getMaxRound, getNumPlayers, segmentToRound, calculateLifePerTurn, extractWinner, type TurnRange } from './turns.js';
import { classifyLine } from './classify.js';
import { shouldIgnoreLine } from './filter.js';

// -----------------------------------------------------------------------------
// Player Attribution
// -----------------------------------------------------------------------------

/**
 * Represents a line with its attributed player and turn.
 */
interface AttributedLine {
  /** The raw line content */
  line: string;
  /** The turn number */
  turnNumber: number;
  /** The player this action belongs to */
  player: string;
  /** Classified event type (if any) */
  eventType: EventType | null;
}

/**
 * Attributes each line in the log to a player and turn.
 *
 * Lines following "Turn N: Player X" belong to Player X until the next
 * turn marker.
 *
 * @param rawLog - The complete raw log text
 * @returns Array of attributed lines
 */
export function attributeLines(rawLog: string): AttributedLine[] {
  const attributed: AttributedLine[] = [];
  const ranges = extractTurnRanges(rawLog);

  if (ranges.length === 0) {
    // No turn markers found - return all lines as turn 0, unknown player
    const lines = rawLog.split(/\r?\n/);
    for (const line of lines) {
      if (line.trim()) {
        attributed.push({
          line: line.trim(),
          turnNumber: 0,
          player: 'Unknown',
          eventType: classifyLine(line),
        });
      }
    }
    return attributed;
  }

  // -------------------------------------------------------------------------
  // Process each turn segment
  // -------------------------------------------------------------------------
  const chunks = sliceByTurn(rawLog, ranges);

  for (const { turnNumber, player, chunk } of chunks) {
    const playerName = player ?? 'Unknown';
    const lines = chunk.split(/\r?\n/);

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Skip the turn marker line itself (it just says "Turn N: Player X")
      if (/^Turn\s+\d+/i.test(trimmed)) continue;

      attributed.push({
        line: trimmed,
        turnNumber,
        player: playerName,
        eventType: classifyLine(trimmed),
      });
    }
  }

  return attributed;
}

// -----------------------------------------------------------------------------
// Structured Game Building
// -----------------------------------------------------------------------------

/**
 * Builds a structured game representation from raw log.
 *
 * This is the main entry point for creating per-deck/per-turn data.
 * All turn numbers are round-based: a "round" is one full rotation
 * where each player takes a turn.
 *
 * @param rawLog - The complete raw log text
 * @param deckNames - Optional array of deck names [hero, opp1, opp2, opp3]
 * @returns StructuredGame object for frontend consumption
 */
export function buildStructuredGame(
  rawLog: string,
  deckNames?: string[]
): StructuredGame {
  const normalized = rawLog.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const ranges = extractTurnRanges(normalized);
  const attributedLines = attributeLines(normalized);
  
  // Determine number of players and calculate round-based total turns
  const numPlayers = getNumPlayers(ranges);
  const totalTurns = getMaxRound(ranges, numPlayers);

  // -------------------------------------------------------------------------
  // Step 1: Collect unique players from the log
  // -------------------------------------------------------------------------
  const playersSet = new Set<string>();
  for (const range of ranges) {
    if (range.player) {
      playersSet.add(range.player);
    }
  }
  const players = Array.from(playersSet);

  // -------------------------------------------------------------------------
  // Step 2: Build turn-by-turn structure (using round numbers)
  // -------------------------------------------------------------------------
  // Format: turns[roundNumber] = { turnNumber, segments: [{ playerId, lines }] }
  const turnMap: Map<
    number,
    Map<string, string[]>
  > = new Map();

  for (const attr of attributedLines) {
    // Convert segment-based turnNumber to round-based
    const round = segmentToRound(attr.turnNumber, numPlayers);
    
    if (!turnMap.has(round)) {
      turnMap.set(round, new Map());
    }
    const playerMap = turnMap.get(round)!;
    if (!playerMap.has(attr.player)) {
      playerMap.set(attr.player, []);
    }
    playerMap.get(attr.player)!.push(attr.line);
  }

  // Convert to array format
  const turns: StructuredGame['turns'] = [];
  const sortedRoundNumbers = Array.from(turnMap.keys()).sort((a, b) => a - b);

  for (const roundNumber of sortedRoundNumbers) {
    const playerMap = turnMap.get(roundNumber)!;
    const segments: { playerId: string; lines: string[] }[] = [];

    for (const [playerId, lines] of playerMap) {
      segments.push({ playerId, lines });
    }

    turns.push({ turnNumber: roundNumber, segments });
  }

  // -------------------------------------------------------------------------
  // Step 3: Build per-deck history (using round numbers)
  // -------------------------------------------------------------------------
  // Format: decks[i] = { deckLabel, turns: [{ turnNumber (round), actions }] }
  const deckMap: Map<string, DeckTurnActions[]> = new Map();

  for (const attr of attributedLines) {
    // Convert segment-based turnNumber to round-based
    const round = segmentToRound(attr.turnNumber, numPlayers);
    
    if (!deckMap.has(attr.player)) {
      deckMap.set(attr.player, []);
    }

    const deckTurns = deckMap.get(attr.player)!;
    let currentTurn = deckTurns.find((t) => t.turnNumber === round);

    if (!currentTurn) {
      currentTurn = { turnNumber: round, actions: [] };
      deckTurns.push(currentTurn);
    }

    const action: DeckAction = {
      line: attr.line,
    };
    if (attr.eventType) {
      action.eventType = attr.eventType;
    }
    currentTurn.actions.push(action);
  }

  // Sort each deck's turns and create DeckHistory objects
  const decks: DeckHistory[] = [];
  const deckLabels = deckNames ?? Array.from(deckMap.keys());
  const logPlayerKeys = Array.from(deckMap.keys());

  for (let i = 0; i < deckLabels.length; i++) {
    // When deckNames is provided, match by name (log uses "Ai(N)-DeckName") so Hero column is correct
    const playerKey =
      (deckNames &&
        logPlayerKeys.find(
          (k) => k === deckNames[i] || k.endsWith('-' + deckNames[i])
        )) ??
      players[i] ??
      deckLabels[i];
    const label = deckNames?.[i] ?? playerKey;
    const deckTurns = deckMap.get(playerKey) ?? [];

    // Sort turns by round number
    deckTurns.sort((a, b) => a.turnNumber - b.turnNumber);

    decks.push({
      deckLabel: label,
      turns: deckTurns,
    });
  }

  // Handle case where we have more players in the log than deck names provided
  for (const player of players) {
    if (!decks.find((d) => d.deckLabel === player || deckLabels.includes(player))) {
      const deckTurns = deckMap.get(player) ?? [];
      deckTurns.sort((a, b) => a.turnNumber - b.turnNumber);
      decks.push({
        deckLabel: player,
        turns: deckTurns,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Step 4: Calculate life totals per round
  // -------------------------------------------------------------------------
  const lifePerTurn = calculateLifePerTurn(normalized, players, numPlayers);

  // -------------------------------------------------------------------------
  // Step 5: Extract winner and winning turn (round)
  // -------------------------------------------------------------------------
  const winner = extractWinner(rawLog);
  const winningTurn = totalTurns > 0 ? totalTurns : undefined;

  return {
    totalTurns,
    players,
    turns,
    decks,
    lifePerTurn,
    ...(winner && { winner }),
    ...(winningTurn !== undefined && { winningTurn }),
  };
}

/**
 * Filters structured game data to only include significant events.
 *
 * This reduces the amount of data sent to the frontend by removing
 * lines that didn't classify to any event type.
 *
 * @param structured - A StructuredGame object
 * @returns A new StructuredGame with only significant actions
 */
export function filterStructuredToSignificant(
  structured: StructuredGame
): StructuredGame {
  return {
    ...structured,
    decks: structured.decks.map((deck) => ({
      ...deck,
      turns: deck.turns.map((turn) => ({
        ...turn,
        actions: turn.actions.filter((action) => action.eventType !== undefined),
      })).filter((turn) => turn.actions.length > 0),
    })),
    turns: structured.turns.map((turn) => ({
      ...turn,
      segments: turn.segments.map((seg) => ({
        ...seg,
        // Keep all lines in segments (raw view) - don't filter here
        lines: seg.lines,
      })),
    })),
  };
}
