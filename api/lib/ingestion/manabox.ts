import { ParsedDeck, DeckCard } from './to-dck';

// ManaBox URL patterns:
// https://manabox.app/decks/iB_rScEtT_6hnOlPUUQ-vA
// https://www.manabox.app/decks/...
const MANABOX_URL_PATTERN = /^https?:\/\/(?:www\.)?manabox\.app\/decks\/([a-zA-Z0-9_-]+)/;

export function isManaboxUrl(url: string): boolean {
  return MANABOX_URL_PATTERN.test(url);
}

export function extractManaboxDeckId(url: string): string | null {
  const match = url.match(MANABOX_URL_PATTERN);
  return match ? match[1] : null;
}

/**
 * ManaBox does not document a public API. We fetch the deck page HTML and parse
 * embedded JSON-like data (from Astro/Islands hydration). Card entries appear as:
 * "name":[0,"Card Name"],"quantity":[0,N],"boardCategory":[0,X]
 * boardCategory: 0=commander, 3=mainboard, 4=sideboard, 5=maybeboard
 */
export async function fetchDeckFromManaboxUrl(url: string): Promise<ParsedDeck> {
  const deckId = extractManaboxDeckId(url);
  if (!deckId) {
    throw new Error(`Invalid ManaBox URL: ${url}`);
  }

  const pageUrl = `https://manabox.app/decks/${deckId}`;
  const response = await fetch(pageUrl, {
    headers: {
      Accept: 'text/html',
      'User-Agent': 'MagicBracketSimulator/1.0',
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Deck not found: ${deckId}`);
    }
    throw new Error(`Failed to fetch ManaBox deck: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();

  // Extract deck name from page title (first <title> in document)
  const titleMatch = html.match(/<title>([^<]+)<\/title>/);
  const name = titleMatch ? titleMatch[1].trim() : 'Imported ManaBox Deck';

  // Unescape HTML entities for parsing
  const normalized = html
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // Parse card entries: "name":[0,"Card Name"],"quantity":[0,N],"boardCategory":[0,X]
  const cardPattern =
    /"name":\[0,"([^"]+)"\],"quantity":\[0,(\d+)\],"boardCategory":\[0,(\d+)\]/g;

  const commanders: DeckCard[] = [];
  const mainboard: DeckCard[] = [];
  const seenMainboard = new Map<string, number>();
  const seenCommanders = new Map<string, number>();

  let match: RegExpExecArray | null;
  while ((match = cardPattern.exec(normalized)) !== null) {
    const cardName = match[1];
    const quantity = parseInt(match[2], 10);
    const boardCategory = parseInt(match[3], 10);

    if (boardCategory === 0) {
      const existing = seenCommanders.get(cardName) ?? 0;
      seenCommanders.set(cardName, existing + quantity);
    } else if (boardCategory === 3) {
      const existing = seenMainboard.get(cardName) ?? 0;
      seenMainboard.set(cardName, existing + quantity);
    }
    // boardCategory 4=sideboard, 5=maybeboard - omit for simulation
  }

  // Deduplicate and build lists (same card can appear multiple times in HTML)
  for (const [cardName, quantity] of seenCommanders) {
    commanders.push({ name: cardName, quantity, isCommander: true });
  }
  for (const [cardName, quantity] of seenMainboard) {
    mainboard.push({ name: cardName, quantity });
  }

  if (commanders.length === 0 && mainboard.length === 0) {
    throw new Error(`Could not parse deck data from ManaBox: ${deckId}`);
  }

  return {
    name,
    commanders,
    mainboard,
  };
}
