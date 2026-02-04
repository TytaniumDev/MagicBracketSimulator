import { ParsedDeck, DeckCard } from './to-dck';
import { MoxfieldApi } from '../moxfield-api';

// Moxfield URL patterns:
// https://moxfield.com/decks/ABC123
// https://www.moxfield.com/decks/ABC123
const MOXFIELD_URL_PATTERN = /^https?:\/\/(?:www\.)?moxfield\.com\/decks\/([a-zA-Z0-9_-]+)/;

export function isMoxfieldUrl(url: string): boolean {
  return MOXFIELD_URL_PATTERN.test(url);
}

export function extractMoxfieldDeckId(url: string): string | null {
  const match = url.match(MOXFIELD_URL_PATTERN);
  return match ? match[1] : null;
}

export async function fetchDeckFromMoxfieldUrl(url: string): Promise<ParsedDeck> {
  const deckId = extractMoxfieldDeckId(url);
  if (!deckId) {
    throw new Error(`Invalid Moxfield URL: ${url}`);
  }

  // This will throw if MOXFIELD_USER_AGENT is not configured,
  // effectively disabling URL ingestion for Moxfield in that case.
  const moxfieldDeck = await MoxfieldApi.fetchDeck(deckId);

  const commanders: DeckCard[] = moxfieldDeck.commanders.map(c => ({
    name: c.name,
    quantity: c.quantity,
    isCommander: true,
  }));

  const mainboard: DeckCard[] = moxfieldDeck.mainboard.map(c => ({
    name: c.name,
    quantity: c.quantity,
  }));

  return {
    name: moxfieldDeck.name,
    commanders,
    mainboard,
  };
}
