/**
 * =============================================================================
 * Forge Log Analyzer - Line Filtering
 * =============================================================================
 *
 * This module handles the FIRST STEP of the condensing pipeline:
 * filtering out noise lines that don't contribute to power-level analysis.
 *
 * ## Why Filter?
 *
 * Raw Forge logs can be 10-100KB per game. Most of that is:
 *   - "Player passes priority" (dozens per turn)
 *   - Phase markers ("Untap step", "Draw step")
 *   - Empty lines
 *
 * Filtering reduces log size by ~80%, making AI analysis faster and cheaper.
 *
 * ## Filter Logic
 *
 * A line is IGNORED if:
 *   1. It's empty or whitespace-only
 *   2. It matches any IGNORE pattern (priority, untap, draw step, bare turn)
 *
 * EXCEPTION: If a line matches IGNORE_DRAW_STEP but ALSO matches
 * KEEP_EXTRA_DRAW, we KEEP it. This catches "Draw step: Player draws 3 cards."
 *
 * =============================================================================
 */

import {
  IGNORE_PATTERNS,
  IGNORE_DRAW_STEP,
  KEEP_EXTRA_DRAW,
} from './patterns';

/**
 * Determines if a log line should be filtered out (ignored).
 *
 * @param line - A single line from the Forge log
 * @returns true if the line should be IGNORED, false if it should be kept
 *
 * @example
 * shouldIgnoreLine("Player A passes priority.") // true - noise
 * shouldIgnoreLine("Player A casts Sol Ring.")   // false - significant
 * shouldIgnoreLine("Draw step.")                 // true - normal draw
 * shouldIgnoreLine("Draw step: draws 3 cards")   // false - extra draw!
 */
export function shouldIgnoreLine(line: string): boolean {
  // -------------------------------------------------------------------------
  // Step 1: Handle empty/whitespace lines
  // -------------------------------------------------------------------------
  // Empty lines provide no information. Skip them immediately.
  const trimmed = line.trim();
  if (trimmed === '') {
    return true; // Ignore empty lines
  }

  // -------------------------------------------------------------------------
  // Step 2: Check against ignore patterns
  // -------------------------------------------------------------------------
  // We iterate through all ignore patterns. If any match, we (usually) ignore.
  for (const pattern of IGNORE_PATTERNS) {
    if (pattern.test(trimmed)) {
      // -----------------------------------------------------------------------
      // Special case: Draw step with extra card draw
      // -----------------------------------------------------------------------
      // The IGNORE_DRAW_STEP pattern would filter out "Draw step." lines.
      // But if the line also mentions extra draws (e.g., "draws 3 cards"),
      // we want to KEEP it because extra card draw is significant.
      //
      // We check if this is the draw step pattern AND if extra draw is present.
      if (pattern === IGNORE_DRAW_STEP || pattern.source.includes('draw')) {
        if (KEEP_EXTRA_DRAW.test(trimmed)) {
          // This line has extra card draw info - DON'T ignore it!
          return false;
        }
      }

      // Pattern matched and no exception applies - ignore this line
      return true;
    }
  }

  // -------------------------------------------------------------------------
  // Step 3: Line didn't match any ignore pattern
  // -------------------------------------------------------------------------
  // This line might be significant. Return false so it proceeds to classification.
  return false;
}

/**
 * Filters an array of lines, removing noise.
 *
 * This is a convenience wrapper around shouldIgnoreLine for batch processing.
 *
 * @param lines - Array of log lines to filter
 * @returns Array of lines that passed the filter (should be kept)
 *
 * @example
 * const raw = ["Player A casts Sol Ring.", "Player A passes priority.", ""];
 * const filtered = filterLines(raw);
 * // Result: ["Player A casts Sol Ring."]
 */
export function filterLines(lines: string[]): string[] {
  return lines.filter((line) => !shouldIgnoreLine(line));
}

/**
 * Splits raw log text into lines and filters out noise.
 *
 * This is the main entry point for the filtering step.
 *
 * @param rawLog - The complete raw log text for a game
 * @returns Array of significant lines (noise removed)
 *
 * @example
 * const rawLog = "Turn 1: Player A\nPlayer A passes priority.\nPlayer A casts Sol Ring.";
 * const lines = splitAndFilter(rawLog);
 * // Result: ["Turn 1: Player A", "Player A casts Sol Ring."]
 */
export function splitAndFilter(rawLog: string): string[] {
  // Split on newlines (handles both \n and \r\n)
  const lines = rawLog.split(/\r?\n/);

  // Apply filter to remove noise
  return filterLines(lines);
}
