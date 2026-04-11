import { ParsedDeck, DeckCard } from './to-dck';

// ManaPool URL patterns:
// https://manapool.com/lists/5dc58054-55a8-4ca4-85c4-ae8e12d1b3d5
// https://manapool.com/lists/5dc58054-55a8-4ca4-85c4-ae8e12d1b3d5?ref=cah
// https://www.manapool.com/lists/5dc58054-55a8-4ca4-85c4-ae8e12d1b3d5
const MANAPOOL_URL_PATTERN =
  /^https?:\/\/(?:www\.)?manapool\.com\/lists\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

const FORMAT_CHANGE_HINT =
  'ManaPool may have changed their internal data format. ' +
  'Try pasting your deck list as text instead, or report this issue.';

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
function dv(data: DevalueData, shape: DevalueShape | undefined, field: string): unknown {
  if (!shape) return undefined;
  const idx = shape[field];
  return idx !== undefined ? data[idx] : undefined;
}

/** Type-guard: is value a devalue shape object (string keys → number values)? */
function isDevalueShape(value: unknown): value is DevalueShape {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every(v => typeof v === 'number');
}

/**
 * Fetch a ManaPool deck list by UUID via SvelteKit's __data.json endpoint.
 *
 * NOTE: ManaPool has no public API for fetching deck lists. This uses their
 * internal SvelteKit data endpoint, which may break if they change their site.
 */
export async function fetchDeckFromManaPoolUrl(url: string): Promise<ParsedDeck> {
  const listId = extractManaPoolListId(url);
  if (!listId) {
    throw new Error(`Invalid ManaPool URL: ${url}`);
  }

  const dataUrl = `https://manapool.com/lists/${listId}/__data.json`;
  let response: Response;
  try {
    response = await fetch(dataUrl, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'MagicBracketSimulator/1.0',
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    throw new Error(
      `Could not reach ManaPool (network error). Please check the URL and try again.`,
      { cause: err }
    );
  }

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`ManaPool list not found: ${listId}`);
    }
    if (response.status === 403) {
      throw new Error(`ManaPool list is private or not accessible: ${listId}`);
    }
    throw new Error(
      `Failed to fetch ManaPool list (HTTP ${response.status}). ${FORMAT_CHANGE_HINT}`
    );
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new Error(
      `ManaPool returned non-JSON response for list ${listId}. ${FORMAT_CHANGE_HINT}`
    );
  }

  const typed = json as { type?: string; nodes?: { type?: string; data?: DevalueData }[] };
  if (!typed || typed.type !== 'data' || !Array.isArray(typed.nodes)) {
    throw new Error(
      `Unexpected response structure from ManaPool for list ${listId}. ${FORMAT_CHANGE_HINT}`
    );
  }

  // Find the node whose devalue shape contains deck/cards fields.
  // Previously hardcoded to nodes[1], but we search to tolerate layout changes.
  const dataNode = typed.nodes.find(n => {
    if (!Array.isArray(n?.data) || n.data.length === 0) return false;
    const shape = n.data[0];
    if (!isDevalueShape(shape)) return false;
    return 'cards' in shape || 'deck' in shape;
  });
  if (!dataNode?.data) {
    throw new Error(
      `Could not locate deck data in ManaPool response for list ${listId}. ${FORMAT_CHANGE_HINT}`
    );
  }

  return parseSvelteKitDevalueData(dataNode.data, listId);
}

function parseSvelteKitDevalueData(data: DevalueData, listId: string): ParsedDeck {
  const pageShape = data[0];
  if (!isDevalueShape(pageShape)) {
    throw new Error(
      `Could not parse page structure from ManaPool list ${listId}. ${FORMAT_CHANGE_HINT}`
    );
  }

  // Resolve deck name — try known field names for resilience
  let deckName = `ManaPool List ${listId}`;
  const deckIdx = pageShape.deck ?? pageShape.list;
  if (deckIdx !== undefined) {
    const deckShape = data[deckIdx];
    if (isDevalueShape(deckShape)) {
      const name = dv(data, deckShape, 'name') as string | undefined;
      if (name) deckName = name;
    }
  }

  // Resolve cards array — try known field names
  const cardsIdx = pageShape.cards ?? pageShape.items ?? pageShape.entries;
  const cardsArray = cardsIdx !== undefined ? data[cardsIdx] : undefined;
  if (!Array.isArray(cardsArray)) {
    throw new Error(
      `Could not find card list in ManaPool list ${listId}. ${FORMAT_CHANGE_HINT}`
    );
  }

  const commanders: DeckCard[] = [];
  const mainboard: DeckCard[] = [];

  for (const cardEntryIdx of cardsArray) {
    if (typeof cardEntryIdx !== 'number') continue;
    const entryShape = data[cardEntryIdx];
    if (!isDevalueShape(entryShape)) continue;

    const quantity = Math.max(1, Number(dv(data, entryShape, 'quantity')) || 1);
    const isCommander = dv(data, entryShape, 'is_commander') === true;

    // Card name is nested: entry.card.name
    const cardObjShape = dv(data, entryShape, 'card');
    if (!isDevalueShape(cardObjShape)) continue;
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
    throw new Error(
      `Could not parse any cards from ManaPool list ${listId}. ${FORMAT_CHANGE_HINT}`
    );
  }

  return { name: deckName, commanders, mainboard };
}
