/**
 * =============================================================================
 * Forge Log Analyzer - Line Classification
 * =============================================================================
 *
 * This module handles the SECOND STEP of the condensing pipeline:
 * classifying each line into an event type.
 *
 * ## Why Classify?
 *
 * Not all "significant" lines are equal. The AI needs to understand:
 *   - Is this line about damage? Spell casting? Winning?
 *   - Is this a powerful play (CMC 7 spell) or routine (CMC 1)?
 *
 * Classification adds structure that helps the AI reason about power level.
 *
 * ## Classification Priority
 *
 * Lines are checked against patterns in a specific order. The FIRST match
 * determines the event type. Order matters because some lines could match
 * multiple patterns (e.g., "casts Expropriate" matches both SPELL_CAST
 * and SPELL_HIGH_CMC).
 *
 * Priority order (highest first):
 *   1. WIN_CONDITION - Game-ending events are most critical
 *   2. LIFE_CHANGE - Damage and life gain affect game state
 *   3. ZONE_CHANGE_GY_BF - Reanimation/recursion (powerful)
 *   4. SPELL_HIGH_CMC - Big spells indicate power
 *   5. COMMANDER_CAST - Commander-specific
 *   6. EXTRA_DRAW - Card advantage
 *   7. COMBAT - Attack declarations
 *   8. LAND_PLAYED - Land drops for mana development
 *   9. SPELL_CAST - Generic spell activity
 *
 * =============================================================================
 */

import type { EventType, GameEvent } from '../types';
import {
  KEEP_WIN_CONDITION,
  KEEP_LIFE_CHANGE,
  KEEP_ZONE_CHANGE_GY_BF,
  KEEP_SPELL_HIGH_CMC,
  KEEP_SPELL_CAST,
  KEEP_COMMANDER_CAST,
  KEEP_EXTRA_DRAW,
  KEEP_COMBAT,
  KEEP_LAND_PLAYED,
  EXTRACT_CMC,
} from './patterns';

/**
 * Classifies a single log line into an event type.
 *
 * Returns the event type if the line is significant, or null if it
 * should not be kept (doesn't match any "keep" pattern).
 *
 * @param line - A filtered log line (already passed noise filter)
 * @returns The event type, or null if line is not significant
 *
 * @example
 * classifyLine("Player A wins the game.")        // "win_condition"
 * classifyLine("Player A loses 5 life.")         // "life_change"
 * classifyLine("Player A casts Expropriate (9)") // "spell_cast_high_cmc"
 * classifyLine("Turn 3: Player B")               // null (turn markers aren't events)
 */
export function classifyLine(line: string): EventType | null {
  // -------------------------------------------------------------------------
  // Priority 1: Win Condition
  // -------------------------------------------------------------------------
  // Game-ending events are the most important. If someone won, we need to
  // know immediately. This helps calculate "win turn" for power assessment.
  if (KEEP_WIN_CONDITION.test(line)) {
    return 'win_condition';
  }

  // -------------------------------------------------------------------------
  // Priority 2: Life Changes
  // -------------------------------------------------------------------------
  // Life total changes indicate damage dealt or life gain. Critical for
  // understanding game pacing (how fast is damage being dealt?).
  if (KEEP_LIFE_CHANGE.test(line)) {
    return 'life_change';
  }

  // -------------------------------------------------------------------------
  // Priority 3: Zone Changes (Graveyard -> Battlefield)
  // -------------------------------------------------------------------------
  // Reanimation and recursion are powerful strategies. Moving cards from
  // graveyard to battlefield often indicates combo or value engines.
  if (KEEP_ZONE_CHANGE_GY_BF.test(line)) {
    return 'zone_change_gy_to_bf';
  }

  // -------------------------------------------------------------------------
  // Priority 4: High CMC Spell Cast
  // -------------------------------------------------------------------------
  // Casting expensive spells (CMC 5+) indicates power and ramp capability.
  // We check this BEFORE generic spell cast to give it higher priority.
  //
  // There are two ways to detect high CMC:
  //   a) Pattern matches "CMC 5", "CMC 6", etc. directly
  //   b) Extract CMC from "(CMC N)" or "(N)" and check if >= 5
  if (KEEP_SPELL_HIGH_CMC.test(line)) {
    return 'spell_cast_high_cmc';
  }

  // Also check for CMC in parentheses that the main pattern might miss
  const cmcMatch = EXTRACT_CMC.exec(line);
  if (cmcMatch) {
    const cmc = parseInt(cmcMatch[1], 10);
    if (cmc >= 5) {
      return 'spell_cast_high_cmc';
    }
  }

  // -------------------------------------------------------------------------
  // Priority 5: Commander Cast
  // -------------------------------------------------------------------------
  // In Commander format, casting your commander is significant. Commanders
  // often enable the deck's core strategy.
  if (KEEP_COMMANDER_CAST.test(line)) {
    return 'commander_cast';
  }

  // -------------------------------------------------------------------------
  // Priority 6: Extra Card Draw
  // -------------------------------------------------------------------------
  // Drawing extra cards indicates card advantage engines (Rhystic Study,
  // Consecrated Sphinx, etc.). More cards = more power.
  if (KEEP_EXTRA_DRAW.test(line)) {
    return 'draw_extra';
  }

  // -------------------------------------------------------------------------
  // Priority 7: Combat
  // -------------------------------------------------------------------------
  // Combat damage is how most games end. Tracking attacks helps understand
  // the deck's aggression level and threat generation.
  if (KEEP_COMBAT.test(line)) {
    return 'combat';
  }

  // -------------------------------------------------------------------------
  // Priority 8: Land Played
  // -------------------------------------------------------------------------
  // Land drops indicate mana development. Tracking lands helps understand
  // ramp and curve consistency.
  if (KEEP_LAND_PLAYED.test(line)) {
    return 'land_played';
  }

  // -------------------------------------------------------------------------
  // Priority 9: Generic Spell Cast
  // -------------------------------------------------------------------------
  // Any spell cast is activity worth noting, even if it's not high CMC.
  // A deck casting 5 spells per turn is more active than one casting 1.
  if (KEEP_SPELL_CAST.test(line)) {
    return 'spell_cast';
  }

  // -------------------------------------------------------------------------
  // No Match
  // -------------------------------------------------------------------------
  // Line didn't match any "keep" pattern. It might be:
  //   - A turn marker (handled separately)
  //   - A phase announcement
  //   - Other unclassified text
  // Return null to indicate this line shouldn't become an event.
  return null;
}

/**
 * Classifies a line and creates a GameEvent object if significant.
 *
 * This is the main entry point for creating events from lines.
 *
 * @param line - A filtered log line
 * @param turn - Optional turn number for context
 * @param player - Optional active player for context
 * @returns A GameEvent object, or null if the line is not significant
 */
export function createEvent(
  line: string,
  turn?: number,
  player?: string
): GameEvent | null {
  const type = classifyLine(line);

  if (type === null) {
    return null;
  }

  // Create the event object with available metadata
  const event: GameEvent = {
    type,
    // Truncate line to 200 chars to prevent huge events from bloating output
    line: line.trim().slice(0, 200),
  };

  // Add optional metadata if available
  if (turn !== undefined) {
    event.turn = turn;
  }
  if (player !== undefined) {
    event.player = player;
  }

  return event;
}

/**
 * Classifies all lines and returns an array of GameEvents.
 *
 * Filters out lines that don't classify to any event type.
 *
 * @param lines - Array of filtered log lines
 * @returns Array of GameEvent objects
 */
export function classifyLines(lines: string[]): GameEvent[] {
  const events: GameEvent[] = [];

  for (const line of lines) {
    const event = createEvent(line);
    if (event !== null) {
      events.push(event);
    }
  }

  return events;
}
