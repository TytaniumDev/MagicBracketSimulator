import { isMoxfieldUrl, fetchDeckFromMoxfieldUrl } from './moxfield';
import { isArchidektUrl, fetchDeckFromArchidektUrl } from './archidekt';
import { isManaboxUrl, fetchDeckFromManaboxUrl } from './manabox';
import { ParsedDeck, toDck } from './to-dck';
import { parseTextDeckWithAutoName } from './text-parser';

export type { ParsedDeck, DeckCard } from './to-dck';
export { toDck } from './to-dck';
export { isMoxfieldUrl, fetchDeckFromMoxfieldUrl } from './moxfield';
export { isArchidektUrl, fetchDeckFromArchidektUrl } from './archidekt';
export { isManaboxUrl, fetchDeckFromManaboxUrl } from './manabox';
export { parseTextDeck, parseTextDeckWithAutoName, extractDeckName } from './text-parser';

/**
 * Detect the deck source from a URL and fetch the deck
 */
export async function fetchDeckFromUrl(url: string): Promise<ParsedDeck> {
  if (isMoxfieldUrl(url)) {
    return fetchDeckFromMoxfieldUrl(url);
  }

  if (isArchidektUrl(url)) {
    return fetchDeckFromArchidektUrl(url);
  }

  if (isManaboxUrl(url)) {
    return fetchDeckFromManaboxUrl(url);
  }

  throw new Error(`Unsupported deck URL. Please use Moxfield, Archidekt, or ManaBox URLs.`);
}

/**
 * Fetch deck from URL and convert to .dck format
 */
export async function fetchDeckAsDck(url: string): Promise<{ name: string; dck: string }> {
  const deck = await fetchDeckFromUrl(url);
  return {
    name: deck.name,
    dck: toDck(deck),
  };
}

/**
 * Parse deck text and convert to .dck format
 */
export function parseTextAsDck(text: string): { name: string; dck: string } {
  const deck = parseTextDeckWithAutoName(text);
  return {
    name: deck.name,
    dck: toDck(deck),
  };
}
