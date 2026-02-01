import { ParsedDeck, DeckCard } from './to-dck';

const MOXFIELD_API_BASE = 'https://api2.moxfield.com/v3';

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

interface MoxfieldCard {
  quantity: number;
  card: {
    name: string;
  };
}

interface MoxfieldDeckResponse {
  name: string;
  mainboard: Record<string, MoxfieldCard>;
  commanders: Record<string, MoxfieldCard>;
}

export async function fetchMoxfieldDeck(deckId: string): Promise<ParsedDeck> {
  const url = `${MOXFIELD_API_BASE}/decks/${deckId}`;

  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      // Moxfield may require a user-agent
      'User-Agent': 'MagicBracketSimulator/1.0',
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Deck not found: ${deckId}`);
    }
    throw new Error(`Failed to fetch Moxfield deck: ${response.status} ${response.statusText}`);
  }

  const data: MoxfieldDeckResponse = await response.json();

  const commanders: DeckCard[] = Object.values(data.commanders || {}).map(entry => ({
    name: entry.card.name,
    quantity: entry.quantity,
    isCommander: true,
  }));

  const mainboard: DeckCard[] = Object.values(data.mainboard || {}).map(entry => ({
    name: entry.card.name,
    quantity: entry.quantity,
  }));

  return {
    name: data.name,
    commanders,
    mainboard,
  };
}

export async function fetchDeckFromMoxfieldUrl(url: string): Promise<ParsedDeck> {
  const deckId = extractMoxfieldDeckId(url);
  if (!deckId) {
    throw new Error(`Invalid Moxfield URL: ${url}`);
  }
  return fetchMoxfieldDeck(deckId);
}
