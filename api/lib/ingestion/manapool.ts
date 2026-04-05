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
 * SvelteKit __data.json "devalue" format: a flat array where index 0 is a shape
 * descriptor (mapping field names to indices) and subsequent indices hold values
 * or nested shape descriptors.
 */
type DevalueData = unknown[];

interface DevalueShape {
  [key: string]: number;
}

/** Resolve a field from a devalue shape + data array. */
function dv(data: DevalueData, shape: DevalueShape, field: string): unknown {
  const idx = shape[field];
  return idx !== undefined ? data[idx] : undefined;
}

/**
 * Fetch a ManaPool deck list by UUID via SvelteKit's __data.json endpoint.
 */
export async function fetchDeckFromManaPoolUrl(url: string): Promise<ParsedDeck> {
  const listId = extractManaPoolListId(url);
  if (!listId) {
    throw new Error(`Invalid ManaPool URL: ${url}`);
  }

  const dataUrl = `https://manapool.com/lists/${listId}/__data.json`;
  const response = await fetch(dataUrl, {
    headers: {
      Accept: 'application/json',
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

  const json = await response.json() as { type: string; nodes: { type: string; data: DevalueData }[] };
  if (json.type !== 'data' || !json.nodes?.[1]?.data) {
    throw new Error(`Unexpected response format from ManaPool for list ${listId}`);
  }

  return parseSvelteKitDevalueData(json.nodes[1].data, listId);
}

function parseSvelteKitDevalueData(data: DevalueData, listId: string): ParsedDeck {
  // data[0] is the top-level page shape: { deck, cards, title, ... }
  const pageShape = data[0] as DevalueShape;

  // Resolve deck name
  const deckShape = data[pageShape.deck] as DevalueShape;
  const deckName = (dv(data, deckShape, 'name') as string) ?? `ManaPool List ${listId}`;

  // Resolve cards array
  const cardsArray = data[pageShape.cards] as number[];
  if (!Array.isArray(cardsArray)) {
    throw new Error(`Could not parse card list from ManaPool list ${listId}`);
  }

  const commanders: DeckCard[] = [];
  const mainboard: DeckCard[] = [];

  for (const cardEntryIdx of cardsArray) {
    const entryShape = data[cardEntryIdx] as DevalueShape;

    const quantity = (dv(data, entryShape, 'quantity') as number) ?? 1;
    const isCommander = dv(data, entryShape, 'is_commander') === true;

    // Card name is nested: entry.card.name
    const cardObjShape = data[entryShape.card] as DevalueShape;
    const cardName = dv(data, cardObjShape, 'name') as string | undefined;
    if (!cardName) continue;

    // Set code for Forge matching
    const setCode = dv(data, cardObjShape, 'setCode') as string | undefined;
    const collectorNumber = dv(data, cardObjShape, 'number') as string | undefined;

    const deckCard: DeckCard = {
      name: cardName,
      quantity,
      ...(isCommander ? { isCommander: true } : {}),
      ...(setCode ? { setCode } : {}),
      ...(collectorNumber ? { collectorNumber } : {}),
    };

    if (isCommander) {
      commanders.push(deckCard);
    } else {
      mainboard.push(deckCard);
    }
  }

  if (commanders.length === 0 && mainboard.length === 0) {
    throw new Error(`Could not parse any cards from ManaPool list ${listId}`);
  }

  return { name: deckName, commanders, mainboard };
}
