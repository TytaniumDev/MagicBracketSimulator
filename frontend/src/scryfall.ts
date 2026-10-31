/**
 * Card details from Scryfall, for decklist grouping and hover previews.
 *
 * Uses the /cards/collection endpoint (up to 75 cards per request) so a
 * 100-card deck costs two requests when every printing is found. Called straight from the browser:
 * Scryfall allows CORS, and it keeps card lookups off our API and Firestore.
 */

const COLLECTION_URL = 'https://api.scryfall.com/cards/collection';
const MAX_IDENTIFIERS_PER_REQUEST = 75;

export interface ScryfallCard {
  name: string;
  typeLine: string;
  manaCost: string;
  manaValue: number;
  /** Front face image, or null when Scryfall has none. */
  imageUrl: string | null;
  /** Front face art only, cropped from the card, or null when Scryfall has none. */
  artCropUrl: string | null;
  /** The card's page on Scryfall. */
  scryfallUrl: string | null;
}

interface ScryfallImageUris {
  normal?: string;
  art_crop?: string;
}

interface ScryfallCardJson {
  name: string;
  type_line?: string;
  mana_cost?: string;
  cmc?: number;
  scryfall_uri?: string;
  image_uris?: ScryfallImageUris;
  card_faces?: { type_line?: string; mana_cost?: string; image_uris?: ScryfallImageUris }[];
}

/** Lookup key for a card name: case-insensitive, front face only. */
export function cardKey(name: string): string {
  return name.split(' // ')[0].trim().toLowerCase();
}

export function toScryfallCard(json: ScryfallCardJson): ScryfallCard {
  const front = json.card_faces?.[0];
  return {
    name: json.name,
    typeLine: json.type_line ?? front?.type_line ?? '',
    // Adventure/omen cards join both costs ("{3}{G} // {1}{G}"); show the card's own.
    manaCost: (json.mana_cost || front?.mana_cost || '').split(' // ')[0],
    manaValue: json.cmc ?? 0,
    imageUrl: json.image_uris?.normal ?? front?.image_uris?.normal ?? null,
    artCropUrl: json.image_uris?.art_crop ?? front?.image_uris?.art_crop ?? null,
    scryfallUrl: json.scryfall_uri ?? null,
  };
}

/**
 * Key cards by every face name, so a log line naming an omen or adventure
 * half ("Dynamic Soar") finds its card ("Whirlwing Stormbrood // Dynamic
 * Soar"). The front face wins when two cards share a face name.
 */
export function indexByFace(cards: ScryfallCard[]): Record<string, ScryfallCard> {
  const byKey: Record<string, ScryfallCard> = {};
  for (const card of cards) byKey[cardKey(card.name)] = card;
  for (const card of cards) {
    for (const face of card.name.split(' // ').slice(1)) {
      byKey[cardKey(face)] ??= card;
    }
  }
  return byKey;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/** A card to look up: its name, plus the printing when the decklist names one. */
export interface CardLookup {
  name: string;
  /** Set code, e.g. "c21". */
  setCode?: string;
  /** Collector number within `setCode`, e.g. "263". */
  collectorNumber?: string;
}

/** One entry of a /cards/collection request. */
type ScryfallIdentifier =
  | { set: string; collector_number: string }
  | { name: string; set: string }
  | { name: string };

/**
 * Scryfall resolves split and double-faced cards by their front face
 * ("Fire" → "Fire // Ice") but not always by the joined name.
 */
function frontFace(name: string): string {
  return name.split(' // ')[0].trim();
}

/**
 * The ways to find a card, most specific first: its exact printing, the card
 * in its set (when only the set is known, or the collector number is off),
 * then the card by name alone, which gets Scryfall's default printing.
 */
const LOOKUP_ORDER: ((card: CardLookup) => ScryfallIdentifier | null)[] = [
  (card) =>
    card.setCode && card.collectorNumber
      ? { set: card.setCode.toLowerCase(), collector_number: card.collectorNumber }
      : null,
  (card) => (card.setCode ? { name: frontFace(card.name), set: card.setCode.toLowerCase() } : null),
  (card) => ({ name: frontFace(card.name) }),
];

async function fetchCollection(identifiers: ScryfallIdentifier[]): Promise<ScryfallCard[]> {
  const cards: ScryfallCard[] = [];
  for (const batch of chunk(identifiers, MAX_IDENTIFIERS_PER_REQUEST)) {
    const res = await fetch(COLLECTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ identifiers: batch }),
    });
    if (!res.ok) {
      throw new Error(`Scryfall lookup failed (${res.status})`);
    }
    const body = (await res.json()) as { data?: ScryfallCardJson[] };
    cards.push(...(body.data ?? []).map(toScryfallCard));
  }
  return cards;
}

/**
 * Fetch card details for `cards`, keyed by `cardKey` of each face name (see
 * `indexByFace`). Each card shows its own printing when the decklist names one
 * Scryfall knows, and otherwise falls back down `LOOKUP_ORDER`. A returned
 * card only counts when its name matches, so a wrong collector number can't
 * show some other card. Names Scryfall doesn't recognize are simply absent.
 */
export async function fetchScryfallCards(cards: CardLookup[]): Promise<Record<string, ScryfallCard>> {
  const byKey = new Map<string, CardLookup>();
  for (const card of cards) {
    const key = cardKey(card.name);
    if (!byKey.has(key)) byKey.set(key, card);
  }

  let pending = [...byKey.values()];
  const found: ScryfallCard[] = [];
  for (const identify of LOOKUP_ORDER) {
    const asked = pending.flatMap((card) => {
      const identifier = identify(card);
      return identifier ? [{ card, identifier }] : [];
    });
    if (asked.length === 0) continue;

    const index = indexByFace(await fetchCollection(asked.map((a) => a.identifier)));
    const answered = new Set<CardLookup>();
    for (const { card } of asked) {
      const match = index[cardKey(card.name)];
      if (match) {
        found.push(match);
        answered.add(card);
      }
    }
    pending = pending.filter((card) => !answered.has(card));
    if (pending.length === 0) break;
  }

  return indexByFace(found);
}
