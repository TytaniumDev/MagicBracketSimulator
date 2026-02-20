import { ParsedDeck, DeckCard } from './to-dck';

const ARCHIDEKT_API_BASE = 'https://archidekt.com/api';

// Archidekt URL patterns:
// https://archidekt.com/decks/123456
// https://www.archidekt.com/decks/123456/deck-name
const ARCHIDEKT_URL_PATTERN = /^https?:\/\/(?:www\.)?archidekt\.com\/decks\/(\d+)/;

export function isArchidektUrl(url: string): boolean {
  return ARCHIDEKT_URL_PATTERN.test(url);
}

export function extractArchidektDeckId(url: string): string | null {
  const match = url.match(ARCHIDEKT_URL_PATTERN);
  return match ? match[1] : null;
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

export async function fetchArchidektDeck(deckId: string): Promise<ParsedDeck> {
  const url = `${ARCHIDEKT_API_BASE}/decks/${deckId}/`;

  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Deck not found: ${deckId}`);
    }
    if (response.status === 403) {
      throw new Error(`Deck is private or not accessible: ${deckId}`);
    }
    throw new Error(`Failed to fetch Archidekt deck: ${response.status} ${response.statusText}`);
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
