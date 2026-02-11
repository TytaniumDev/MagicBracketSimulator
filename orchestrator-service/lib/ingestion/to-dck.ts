export interface DeckCard {
  name: string;
  quantity: number;
  isCommander?: boolean;
}

export interface ParsedDeck {
  name: string;
  commanders: DeckCard[];
  mainboard: DeckCard[];
}

/**
 * Converts a ParsedDeck to .dck format for Forge
 * See: forge-simulation-engine/precons/Lorehold Legacies.dck for reference
 */
export function toDck(deck: ParsedDeck): string {
  const lines: string[] = [];

  // Metadata section
  lines.push('[metadata]');
  lines.push(`Name=${cleanDeckName(deck.name)}`);
  lines.push('Format=Commander');

  // Commander section
  lines.push('[commander]');
  for (const card of deck.commanders) {
    lines.push(`${card.quantity} ${cleanCardName(card.name)}`);
  }

  // Main section
  lines.push('[main]');
  for (const card of deck.mainboard) {
    lines.push(`${card.quantity} ${cleanCardName(card.name)}`);
  }

  return lines.join('\n');
}

/**
 * Clean deck name to prevent file format injection
 * Replaces newlines and control characters with spaces
 */
function cleanDeckName(name: string): string {
  // Replace newlines and control characters (ASCII 0-31, 127) with space
  return name.replace(/[\r\n\x00-\x1F\x7F]+/g, ' ').trim();
}

/**
 * Clean card name for Forge:
 * - Strip set codes (e.g., "Sol Ring|2XM" -> "Sol Ring")
 * - Handle double-faced cards (keep as-is, Forge uses "CardName // BackName")
 * - Prevent file format injection by sanitizing newlines
 */
function cleanCardName(name: string): string {
  // Remove set code suffix (pipe notation like "Sol Ring|2XM")
  const pipeIndex = name.indexOf('|');
  if (pipeIndex !== -1) {
    name = name.substring(0, pipeIndex);
  }

  // Replace newlines and control characters with space to prevent injection
  name = name.replace(/[\r\n\x00-\x1F\x7F]+/g, ' ');

  // Trim whitespace
  return name.trim();
}
