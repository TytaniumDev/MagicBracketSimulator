import { ParsedDeck, DeckCard } from './to-dck';

// ManaPool URL patterns:
// https://manapool.com/lists/5dc58054-55a8-4ca4-85c4-ae8e12d1b3d5
// https://manapool.com/lists/5dc58054-55a8-4ca4-85c4-ae8e12d1b3d5?ref=cah
// https://www.manapool.com/lists/5dc58054-55a8-4ca4-85c4-ae8e12d1b3d5
const MANAPOOL_URL_PATTERN =
  /^https?:\/\/(?:www\.)?manapool\.com\/lists\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

export function isManaPoolUrl(url: string): boolean {
  return MANAPOOL_URL_PATTERN.test(url);
}

export function extractManaPoolListId(url: string): string | null {
  const match = url.match(MANAPOOL_URL_PATTERN);
  return match ? match[1] : null;
}

/**
 * ManaPool JSON API response interfaces.
 * The API at https://manapool.com/api/lists/{id} returns a deck list.
 */
interface ManaPoolApiCard {
  quantity: number;
  name?: string;
  card?: { name: string };
  isCommander?: boolean;
  section?: string;
  board?: string;
  category?: string;
}

interface ManaPoolApiResponse {
  name?: string;
  title?: string;
  cards?: ManaPoolApiCard[];
  list?: { name?: string; cards?: ManaPoolApiCard[] };
}

/**
 * Fetch a ManaPool deck list by UUID.
 * Tries the JSON API first, then falls back to HTML scraping.
 */
export async function fetchDeckFromManaPoolUrl(url: string): Promise<ParsedDeck> {
  const listId = extractManaPoolListId(url);
  if (!listId) {
    throw new Error(`Invalid ManaPool URL: ${url}`);
  }

  // Try the JSON API endpoint first
  const apiUrl = `https://manapool.com/api/lists/${listId}`;
  let apiResponse: Response | undefined;
  try {
    apiResponse = await fetch(apiUrl, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'MagicBracketSimulator/1.0',
      },
    });
  } catch {
    // Network error — fall through to HTML scraping
  }

  if (apiResponse && apiResponse.ok) {
    const contentType = apiResponse.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const data: ManaPoolApiResponse = await apiResponse.json();
      const deck = parseManaPoolApiResponse(listId, data);
      if (deck.commanders.length > 0 || deck.mainboard.length > 0) {
        return deck;
      }
    }
  }

  // Fall back to HTML scraping
  return fetchManaPoolDeckFromHtml(listId);
}

function parseManaPoolApiResponse(
  listId: string,
  data: ManaPoolApiResponse
): ParsedDeck {
  // Support both flat structure and nested { list: { name, cards } }
  const rawName =
    data.name ?? data.title ?? data.list?.name ?? `ManaPool List ${listId}`;
  const rawCards = data.cards ?? data.list?.cards ?? [];

  const commanders: DeckCard[] = [];
  const mainboard: DeckCard[] = [];

  for (const entry of rawCards) {
    const cardName = entry.name ?? entry.card?.name;
    if (!cardName) continue;

    const quantity = Math.max(1, entry.quantity ?? 1);

    const isCommander =
      entry.isCommander === true ||
      isCommanderSection(entry.section) ||
      isCommanderSection(entry.board) ||
      isCommanderSection(entry.category);

    const deckCard: DeckCard = { name: cardName, quantity };
    if (isCommander) {
      deckCard.isCommander = true;
      commanders.push(deckCard);
    } else {
      mainboard.push(deckCard);
    }
  }

  return { name: rawName, commanders, mainboard };
}

function isCommanderSection(value: string | undefined): boolean {
  if (!value) return false;
  const lower = value.toLowerCase();
  return lower === 'commander' || lower === 'commanders';
}

/**
 * HTML scraping fallback.
 * Modern web apps often embed page data in a <script id="__NEXT_DATA__"> tag
 * for SSR hydration.
 */
async function fetchManaPoolDeckFromHtml(listId: string): Promise<ParsedDeck> {
  const pageUrl = `https://manapool.com/lists/${listId}`;
  const response = await fetch(pageUrl, {
    headers: {
      Accept: 'text/html',
      'User-Agent': 'MagicBracketSimulator/1.0',
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`ManaPool list not found: ${listId}`);
    }
    if (response.status === 403) {
      throw new Error(`ManaPool list is private or not accessible: ${listId}`);
    }
    throw new Error(
      `Failed to fetch ManaPool list: ${response.status} ${response.statusText}`
    );
  }

  const html = await response.text();

  // Try Next.js __NEXT_DATA__ embedded JSON
  const nextDataMatch = html.match(
    /<script\s+id="__NEXT_DATA__"\s+type="application\/json">([^<]+)<\/script>/
  );
  if (nextDataMatch) {
    try {
      const nextData = JSON.parse(nextDataMatch[1]) as Record<string, unknown>;
      const deck = extractDeckFromNextData(nextData, listId);
      if (deck) return deck;
    } catch {
      // Continue to next parsing method
    }
  }

  throw new Error(
    `Could not parse deck data from ManaPool list ${listId}. ` +
      `The page structure may have changed. Please paste your deck list manually.`
  );
}

/**
 * Extract deck data from Next.js __NEXT_DATA__ payload.
 * Tries common locations where a deck list might be embedded.
 */
function extractDeckFromNextData(
  nextData: Record<string, unknown>,
  listId: string
): ParsedDeck | null {
  const propsObj = nextData.props as Record<string, unknown> | undefined;
  const pageProps = propsObj
    ? (propsObj.pageProps as Record<string, unknown> | undefined)
    : undefined;

  if (!pageProps) return null;

  // Try common locations where deck data might live under pageProps
  const candidates: (Record<string, unknown> | undefined)[] = [
    pageProps,
    pageProps.list as Record<string, unknown> | undefined,
    pageProps.deck as Record<string, unknown> | undefined,
    pageProps.data as Record<string, unknown> | undefined,
  ];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;

    // Look for a cards array with known card fields
    const cards =
      candidate.cards ??
      candidate.cardList ??
      candidate.cardEntries;

    if (!Array.isArray(cards) || cards.length === 0) continue;

    const firstCard = cards[0] as Record<string, unknown>;
    const hasCardName =
      'name' in firstCard ||
      ('card' in firstCard && typeof firstCard.card === 'object');
    if (!hasCardName) continue;

    const rawName =
      (candidate.name as string | undefined) ??
      (candidate.title as string | undefined) ??
      `ManaPool List ${listId}`;

    return parseManaPoolApiResponse(listId, {
      name: rawName,
      cards: cards as ManaPoolApiCard[],
    });
  }

  return null;
}
