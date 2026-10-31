import { ParsedDeck, DeckCard } from './to-dck';

const ARCHIDEKT_API_BASE = 'https://archidekt.com/api';

// Archidekt URL patterns:
// https://archidekt.com/decks/123456
// https://www.archidekt.com/decks/123456/deck-name
export function isArchidektUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    if (parsed.hostname !== 'archidekt.com' && parsed.hostname !== 'www.archidekt.com') return false;
    return /^\/decks\/(\d+)/.test(parsed.pathname);
  } catch {
    return false;
  }
}

export function extractArchidektDeckId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (parsed.hostname !== 'archidekt.com' && parsed.hostname !== 'www.archidekt.com') return null;
    const match = parsed.pathname.match(/^\/decks\/(\d+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

interface ArchidektCard {
  quantity: number;
  categories: string[];
  card: {
    oracleCard: {
      name: string;
    };
    edition?: {
      editioncode?: string;
    };
    collectorNumber?: string;
  };
}

interface ArchidektDeckResponse {
  name: string;
  cards: ArchidektCard[];
}

/** A non-2xx answer from the Archidekt API, with its HTTP status. */
export class ArchidektHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ArchidektHttpError';
  }
}

/** True when Archidekt asked us to slow down (HTTP 429). */
export function isArchidektRateLimit(error: unknown): boolean {
  return error instanceof ArchidektHttpError && error.status === 429;
}

export async function fetchArchidektDeck(deckId: string): Promise<ParsedDeck> {
  const url = `${ARCHIDEKT_API_BASE}/decks/${deckId}/`;

  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new ArchidektHttpError(`Deck not found: ${deckId}`, 404);
    }
    if (response.status === 403) {
      throw new ArchidektHttpError(`Deck is private or not accessible: ${deckId}`, 403);
    }
    throw new ArchidektHttpError(
      `Failed to fetch Archidekt deck: ${response.status} ${response.statusText}`,
      response.status,
    );
  }

  const data: ArchidektDeckResponse = await response.json();

  const commanders: DeckCard[] = [];
  const mainboard: DeckCard[] = [];

  for (const entry of data.cards) {
    const cardName = entry.card.oracleCard.name;
    const quantity = entry.quantity;
    const categories = (entry.categories ?? []).map(c => c.toLowerCase());

    // Check if card is a commander
    const isCommander = categories.includes('commander') || categories.includes('commanders');

    const deckCard: DeckCard = {
      name: cardName,
      quantity,
      isCommander,
      setCode: entry.card.edition?.editioncode || undefined,
      collectorNumber: entry.card.collectorNumber || undefined,
    };

    if (isCommander) {
      commanders.push(deckCard);
    } else {
      mainboard.push(deckCard);
    }
  }

  return {
    name: data.name,
    commanders,
    mainboard,
  };
}

export async function fetchDeckFromArchidektUrl(url: string): Promise<ParsedDeck> {
  const deckId = extractArchidektDeckId(url);
  if (!deckId) {
    throw new Error(`Invalid Archidekt URL: ${url}`);
  }
  return fetchArchidektDeck(deckId);
}
