import { ParsedDeck, DeckCard } from './to-dck';
import { moxfieldFetch } from '../moxfield-service';

const MOXFIELD_API_BASE = 'https://api2.moxfield.com/v3';

// Moxfield URL patterns:
// https://moxfield.com/decks/ABC123
// https://www.moxfield.com/decks/ABC123
export function isMoxfieldUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    if (parsed.hostname !== 'moxfield.com' && parsed.hostname !== 'www.moxfield.com') return false;
    return /^\/decks\/([a-zA-Z0-9_-]+)/.test(parsed.pathname);
  } catch {
    return false;
  }
}

export function extractMoxfieldDeckId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (parsed.hostname !== 'moxfield.com' && parsed.hostname !== 'www.moxfield.com') return null;
    const match = parsed.pathname.match(/^\/decks\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

interface MoxfieldCard {
  quantity: number;
  boardType: string;
  card: {
    name: string;
  };
}

interface MoxfieldBoard {
  count: number;
  cards: Record<string, MoxfieldCard>;
}

interface MoxfieldDeckResponse {
  name: string;
  boards: {
    mainboard?: MoxfieldBoard;
    commanders?: MoxfieldBoard;
    companions?: MoxfieldBoard;
    [key: string]: MoxfieldBoard | undefined;
  };
}

function boardCards(board: MoxfieldBoard | undefined, isCommander: boolean): DeckCard[] {
  if (!board?.cards) return [];
  return Object.values(board.cards).map(entry => ({
    name: entry.card.name,
    quantity: entry.quantity,
    ...(isCommander ? { isCommander: true } : {}),
  }));
}

export async function fetchMoxfieldDeck(deckId: string): Promise<ParsedDeck> {
  const url = `${MOXFIELD_API_BASE}/decks/all/${deckId}`;

  const response = await moxfieldFetch(url);

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Deck not found: ${deckId}`);
    }
    if (response.status === 429) {
      throw new Error('Moxfield rate limit exceeded. Please try again later.');
    }
    throw new Error(
      `Failed to fetch Moxfield deck: ${response.status} ${response.statusText}`
    );
  }

  const data: MoxfieldDeckResponse = await response.json();

  const commanders = [
    ...boardCards(data.boards.commanders, true),
    ...boardCards(data.boards.companions, true),
  ];
  const mainboard = boardCards(data.boards.mainboard, false);

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
