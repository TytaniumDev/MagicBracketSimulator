/**
 * Card details from Scryfall, for decklist grouping and hover previews.
 *
 * Uses the /cards/collection endpoint (up to 75 cards per request) so a
 * 100-card deck costs two requests. Called straight from the browser:
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
  /** The card's page on Scryfall. */
  scryfallUrl: string | null;
}

interface ScryfallImageUris {
  normal?: string;
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

/**
 * Fetch card details for `names`, keyed by `cardKey` of each face name (see
 * `indexByFace`). Names Scryfall doesn't recognize are simply absent.
 */
export async function fetchScryfallCards(names: string[]): Promise<Record<string, ScryfallCard>> {
  // Scryfall resolves split and double-faced cards by their front face
  // ("Fire" → "Fire // Ice") but not always by the joined name.
  const unique = [...new Set(names.map((n) => n.split(' // ')[0].trim()))];
  const cards: ScryfallCard[] = [];

  for (const batch of chunk(unique, MAX_IDENTIFIERS_PER_REQUEST)) {
    const res = await fetch(COLLECTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ identifiers: batch.map((name) => ({ name })) }),
    });
    if (!res.ok) {
      throw new Error(`Scryfall lookup failed (${res.status})`);
    }
    const body = (await res.json()) as { data?: ScryfallCardJson[] };
    cards.push(...(body.data ?? []).map(toScryfallCard));
  }

  return indexByFace(cards);
}
