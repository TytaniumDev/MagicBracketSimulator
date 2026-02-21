/**
 * Deck name matching utilities for resolving Forge log player names
 * (e.g. "Ai(2)-Blood Rites - The Lost Caverns of Ixalan Commander")
 * against short deck names stored in the DB (e.g. "Blood Rites").
 *
 * The canonical matching logic lives here. The frontend has a copy at
 * frontend/src/utils/deck-match.ts — keep both in sync.
 */

/**
 * Returns true if `fullName` refers to the same deck as `shortName`.
 *
 * Handles three formats:
 *   1. Exact match: "Blood Rites" === "Blood Rites"
 *   2. Ai-prefixed suffix match: "Ai(2)-Blood Rites".endsWith("-Blood Rites")
 *   3. Precon set suffix: "Ai(2)-Blood Rites - The Lost Caverns of Ixalan Commander"
 *      → strip prefix → "Blood Rites - The Lost Caverns of Ixalan Commander"
 *      → startsWith("Blood Rites - ")
 */
export function matchesDeckName(fullName: string, shortName: string): boolean {
  if (fullName === shortName) return true;
  if (fullName.endsWith('-' + shortName)) return true;
  // Handle precon names: strip Ai(N)- prefix, check startsWith
  const stripped = fullName.replace(/^Ai\(\d+\)-/, '');
  if (stripped !== fullName) {
    if (stripped === shortName) return true;
    if (stripped.startsWith(shortName + ' - ')) return true;
  }
  return false;
}

/**
 * Finds the matching short deck name for a full winner string, or returns
 * the original string if no match is found.
 */
export function resolveWinnerName(fullName: string, deckNames: string[]): string {
  return deckNames.find((name) => matchesDeckName(fullName, name)) ?? fullName;
}
