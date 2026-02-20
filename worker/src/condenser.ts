/**
 * Log condenser - ported from misc-runner/condenser/*.go
 * Condenses raw game logs into structured summaries for AI analysis
 */

import {
  EventType,
  GameEvent,
  TurnManaInfo,
  CondensedGame,
} from './types.js';

// ============================================================================
// Regex Patterns (from patterns.go)
// ============================================================================

// Ignore patterns - lines matching these should be filtered out
const IgnorePriorityPass = /player\s+passes\s+priority/i;
const IgnoreUntapStep = /untap\s+step/i;
const IgnoreDrawStep = /draw\s+step/i;
const IgnoreBareTurn = /^Turn\s+\d+:\s*$/i;

const IgnorePatterns = [
  IgnorePriorityPass,
  IgnoreUntapStep,
  IgnoreDrawStep,
  IgnoreBareTurn,
];

// Keep patterns - lines matching these are significant events
const KeepExtraDraw = /draw(s)?\s+(an?\s+)?(additional|extra|\d+)\s+card|draw\s+\d+\s+card/i;
const KeepLifeChange = /life\s+(total\s+)?(change|loss|gain|to)|(\d+)\s+life|loses?\s+\d+\s+life|gains?\s+\d+\s+life/i;
const KeepSpellHighCMC = /cast(s|ing)?\s+.*?(?:\(?\s*CMC\s*([5-9]|\d{2,})|\(([5-9]|\d{2,})\s*\))|CMC\s*([5-9]|\d{2,})/i;
const KeepSpellCast = /\bcasts?\s+/i;
const KeepZoneChangeGYBF = /graveyard\s*->\s*battlefield|graveyard\s+to\s+battlefield|put.*from.*graveyard.*onto.*battlefield/i;
const KeepWinCondition = /wins?\s+the\s+game|game\s+over|winner|wins\s+the\s+match|loses\s+the\s+game/i;
const KeepCommanderCast = /casts?\s+(their\s+)?commander|from\s+command\s+zone/i;
const KeepCombat = /attacks?\s+with|declares?\s+attack|combat\s+damage|assigned\s+.*\s+to\s+attack/i;
const KeepLandPlayed = /^Land:/i;

// Extraction patterns
const ExtractTurnMarkerNew = /^Turn:\s*Turn\s+(\d+)\s*\((.+)\)\s*$/i;
const ExtractTurnMarkerOld = /^Turn\s+(\d+):\s*(.+?)\s*$/i;
const ExtractManaProduced = /(?:adds?|produces?|tap(s|ped)?\s+for)\s+[\w\s{}\d]*mana|(\d+)\s+mana\s+produced/i;
const ExtractTapFor = /tap(s|ped)?\s+.*?\s+for/i;
const ExtractDrawMultiple = /draws?\s+(\d+)\s+cards?/i;
const ExtractDrawSingle = /draws?\s+(?:a\s+)?card(?!s)/i;
const ExtractCMC = /\((?:CMC\s*)?(\d+)\)/i;
const ExtractWinnerRegex = /(.+?)\s+(?:wins\s+the\s+game|has\s+won!?)/i;
const GameResultPattern = /^Game Result: Game (\d+) ended/i;

// ============================================================================
// Turn Range Extraction (from condenser.go)
// ============================================================================

interface TurnRange {
  turnNumber: number;
  player: string;
  startIndex: number;
  endIndex: number;
}

function extractTurnRanges(rawLog: string): TurnRange[] {
  const lines = rawLog.replace(/\r\n/g, '\n').split('\n');
  const ranges: TurnRange[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Try new format first: "Turn: Turn N (PlayerName)"
    let matches = ExtractTurnMarkerNew.exec(line);
    if (matches && matches.length > 2) {
      ranges.push({
        turnNumber: parseInt(matches[1], 10),
        player: matches[2],
        startIndex: i,
        endIndex: -1,
      });
      continue;
    }

    // Try old format: "Turn N: PlayerName"
    matches = ExtractTurnMarkerOld.exec(line);
    if (matches && matches.length > 1) {
      ranges.push({
        turnNumber: parseInt(matches[1], 10),
        player: matches[2] || '',
        startIndex: i,
        endIndex: -1,
      });
    }
  }

  // Set end indices
  for (let i = 0; i < ranges.length; i++) {
    if (i < ranges.length - 1) {
      ranges[i].endIndex = ranges[i + 1].startIndex - 1;
    } else {
      ranges[i].endIndex = lines.length - 1;
    }
  }

  return ranges;
}

function getNumPlayers(turnRanges: TurnRange[]): number {
  if (turnRanges.length === 0) {
    return 4; // Default for Commander
  }

  // Count ALL unique players across ALL turns
  const players = new Set<string>();
  for (const tr of turnRanges) {
    if (tr.player) {
      players.add(tr.player);
    }
  }

  return players.size > 0 ? players.size : 4;
}

function getMaxRound(turnRanges: TurnRange[], numPlayers: number): number {
  if (turnRanges.length === 0 || numPlayers === 0) {
    return 0;
  }

  let maxTurn = 0;
  for (const tr of turnRanges) {
    if (tr.turnNumber > maxTurn) {
      maxTurn = tr.turnNumber;
    }
  }

  // Convert to round (full rotation)
  return Math.ceil(maxTurn / numPlayers);
}

// ============================================================================
// Filter Functions (from filter.go)
// ============================================================================

function shouldIgnoreLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed === '') {
    return true;
  }

  for (const pattern of IgnorePatterns) {
    if (pattern.test(trimmed)) {
      // Special case: Draw step with extra card draw should be kept
      if (KeepExtraDraw.test(trimmed)) {
        return false;
      }
      return true;
    }
  }

  return false;
}

function filterLines(lines: string[]): string[] {
  return lines.filter((line) => !shouldIgnoreLine(line));
}

function splitAndFilter(rawLog: string): string[] {
  const lines = rawLog.replace(/\r\n/g, '\n').split('\n');
  return filterLines(lines);
}

/**
 * Split a log that contains multiple concatenated games
 */
export function splitConcatenatedGames(rawLog: string): string[] {
  const lines = rawLog.replace(/\r\n/g, '\n').split('\n');
  const games: string[] = [];
  let currentGame: string[] = [];

  for (const line of lines) {
    if (GameResultPattern.test(line)) {
      // End of a game - save current game and start new one
      currentGame.push(line);
      games.push(currentGame.join('\n'));
      currentGame = [];
    } else {
      currentGame.push(line);
    }
  }

  // Don't forget the last game if it doesn't end with Game Result
  if (currentGame.length > 0) {
    const remaining = currentGame.join('\n').trim();
    if (remaining) {
      games.push(remaining);
    }
  }

  // If no games were split, return the original as a single game
  if (games.length === 0) {
    return [rawLog];
  }

  return games;
}

// ============================================================================
// Classification Functions (from classify.go)
// ============================================================================

function classifyLine(line: string): EventType | null {
  // Priority 1: Win Condition
  if (KeepWinCondition.test(line)) {
    return 'win_condition';
  }

  // Priority 2: Life Changes
  if (KeepLifeChange.test(line)) {
    return 'life_change';
  }

  // Priority 3: Zone Changes (Graveyard -> Battlefield)
  if (KeepZoneChangeGYBF.test(line)) {
    return 'zone_change_gy_to_bf';
  }

  // Priority 4: High CMC Spell Cast
  if (KeepSpellHighCMC.test(line)) {
    return 'spell_cast_high_cmc';
  }

  // Also check for CMC in parentheses that the main pattern might miss
  const cmcMatches = ExtractCMC.exec(line);
  if (cmcMatches && cmcMatches.length > 1) {
    const cmc = parseInt(cmcMatches[1], 10);
    if (cmc >= 5) {
      return 'spell_cast_high_cmc';
    }
  }

  // Priority 5: Commander Cast
  if (KeepCommanderCast.test(line)) {
    return 'commander_cast';
  }

  // Priority 6: Extra Card Draw
  if (KeepExtraDraw.test(line)) {
    return 'draw_extra';
  }

  // Priority 7: Combat
  if (KeepCombat.test(line)) {
    return 'combat';
  }

  // Priority 8: Land Played
  if (KeepLandPlayed.test(line)) {
    return 'land_played';
  }

  // Priority 9: Generic Spell Cast
  if (KeepSpellCast.test(line)) {
    return 'spell_cast';
  }

  return null;
}

function createEvent(
  line: string,
  turn?: number,
  player?: string
): GameEvent | null {
  const eventType = classifyLine(line);
  if (!eventType) {
    return null;
  }

  // Truncate line to 200 chars
  let truncatedLine = line.trim();
  if (truncatedLine.length > 200) {
    truncatedLine = truncatedLine.slice(0, 200);
  }

  const event: GameEvent = {
    type: eventType,
    line: truncatedLine,
  };

  if (turn !== undefined) {
    event.turn = turn;
  }
  if (player !== undefined) {
    event.player = player;
  }

  return event;
}

function classifyLines(lines: string[]): GameEvent[] {
  const events: GameEvent[] = [];
  for (const line of lines) {
    const event = createEvent(line);
    if (event) {
      events.push(event);
    }
  }
  return events;
}

// ============================================================================
// Metrics Calculation (from condenser.go)
// ============================================================================

function calculateManaPerTurn(
  rawLog: string,
  numPlayers: number
): Record<number, TurnManaInfo> {
  if (numPlayers === 0) {
    numPlayers = 4;
  }

  const turnRanges = extractTurnRanges(rawLog);
  const lines = rawLog.replace(/\r\n/g, '\n').split('\n');
  const result: Record<number, TurnManaInfo> = {};

  for (const tr of turnRanges) {
    const round = Math.ceil(tr.turnNumber / numPlayers);
    let manaEvents = 0;

    for (let i = tr.startIndex; i <= tr.endIndex && i < lines.length; i++) {
      if (ExtractManaProduced.test(lines[i]) || ExtractTapFor.test(lines[i])) {
        manaEvents++;
      }
    }

    if (result[round]) {
      result[round].manaEvents += manaEvents;
    } else {
      result[round] = { manaEvents };
    }
  }

  return result;
}

function calculateCardsDrawnPerTurn(
  rawLog: string,
  numPlayers: number
): Record<number, number> {
  if (numPlayers === 0) {
    numPlayers = 4;
  }

  const turnRanges = extractTurnRanges(rawLog);
  const lines = rawLog.replace(/\r\n/g, '\n').split('\n');
  const result: Record<number, number> = {};

  for (const tr of turnRanges) {
    const round = Math.ceil(tr.turnNumber / numPlayers);
    let cardsDrawn = 0;

    for (let i = tr.startIndex; i <= tr.endIndex && i < lines.length; i++) {
      const line = lines[i];
      // Check for multiple draws: "draws N cards"
      const multiMatches = ExtractDrawMultiple.exec(line);
      if (multiMatches && multiMatches.length > 1) {
        cardsDrawn += parseInt(multiMatches[1], 10);
      } else if (ExtractDrawSingle.test(line)) {
        cardsDrawn++;
      }
    }

    result[round] = (result[round] || 0) + cardsDrawn;
  }

  return result;
}

export function extractWinner(rawLog: string): string {
  const matches = ExtractWinnerRegex.exec(rawLog);
  if (matches && matches.length > 1) {
    return matches[1].trim().replace(/^Game outcome:\s*/i, '');
  }
  return '';
}

export function extractWinningTurn(rawLog: string): number {
  const lines = rawLog.replace(/\r\n/g, '\n').split('\n');
  const turnRanges = extractTurnRanges(rawLog);
  const numPlayers = getNumPlayers(turnRanges);

  // Find the line with the win condition and determine its turn
  for (let i = 0; i < lines.length; i++) {
    if (KeepWinCondition.test(lines[i])) {
      // Find which turn range this line belongs to
      for (const tr of turnRanges) {
        if (i >= tr.startIndex && i <= tr.endIndex) {
          // Convert to round
          return Math.ceil(tr.turnNumber / numPlayers);
        }
      }
    }
  }

  // If we can't find the win line in a turn, return the last round
  if (turnRanges.length > 0) {
    return getMaxRound(turnRanges, numPlayers);
  }

  return 0;
}

// ============================================================================
// Main Condenser Functions
// ============================================================================

/**
 * Condense a single raw game log into a structured summary
 */
export function condenseGame(rawLog: string): CondensedGame {
  // Step 1: Filter
  const filteredLines = splitAndFilter(rawLog);

  // Step 2: Classify
  const keptEvents = classifyLines(filteredLines);

  // Step 3: Extract metrics
  const turnRanges = extractTurnRanges(rawLog);
  const numPlayers = getNumPlayers(turnRanges);
  const turnCount = getMaxRound(turnRanges, numPlayers);
  const manaPerTurn = calculateManaPerTurn(rawLog, numPlayers);
  const cardsDrawnPerTurn = calculateCardsDrawnPerTurn(rawLog, numPlayers);

  // Step 4: Detect winner
  const winner = extractWinner(rawLog);
  const winningTurn = extractWinningTurn(rawLog);

  // Step 5: Build output
  const condensed: CondensedGame = {
    keptEvents,
    manaPerTurn,
    cardsDrawnPerTurn,
    turnCount,
  };

  if (winner) {
    condensed.winner = winner;
  }
  if (winningTurn > 0) {
    condensed.winningTurn = winningTurn;
  }

  return condensed;
}

/**
 * Condense multiple game logs
 */
export function condenseGames(rawLogs: string[]): CondensedGame[] {
  return rawLogs.map(condenseGame);
}

