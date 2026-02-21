/**
 * Deck name matching utilities for resolving Forge log player names
 * against short deck names.
 *
 * This is a frontend copy of api/lib/condenser/deck-match.ts — keep both in sync.
 */

export function matchesDeckName(fullName: string, shortName: string): boolean {
  if (fullName === shortName) return true;
  if (fullName.endsWith('-' + shortName)) return true;
  const stripped = fullName.replace(/^Ai\(\d+\)-/, '');
  if (stripped !== fullName) {
    if (stripped === shortName) return true;
    if (stripped.startsWith(shortName + ' - ')) return true;
  }
  return false;
}

export function resolveWinnerName(fullName: string, deckNames: string[]): string {
  return deckNames.find((name) => matchesDeckName(fullName, name)) ?? fullName;
}
