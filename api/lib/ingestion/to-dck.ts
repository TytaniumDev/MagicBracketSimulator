export interface DeckCard {
  name: string;
  quantity: number;
  isCommander?: boolean;
  setCode?: string;
  collectorNumber?: string;
}

export interface ParsedDeck {
  name: string;
  commanders: DeckCard[];
  mainboard: DeckCard[];
}

/**
 * Converts a ParsedDeck to .dck format for Forge
 * Generates Forge-compatible .dck format with [metadata], [commander], [main] sections
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
    lines.push(`${card.quantity} ${formatCardEntry(card)}`);
  }

  // Main section
  lines.push('[main]');
  for (const card of deck.mainboard) {
    lines.push(`${card.quantity} ${formatCardEntry(card)}`);
  }

  return lines.join('\n');
}

/**
 * Format a card entry for .dck output.
 * Emits `Name|SET|CollectorNumber` when set code is available, otherwise just `Name`.
 */
function formatCardEntry(card: DeckCard): string {
  const name = cleanCardName(card.name);
  if (card.setCode) {
    const set = card.setCode.toUpperCase();
    return card.collectorNumber ? `${name}|${set}|${card.collectorNumber}` : `${name}|${set}`;
  }
  return name;
}

/**
 * Sanitize deck name to prevent injection attacks in .dck files
 * Removes newlines and control characters
 */
function cleanDeckName(name: string): string {
  // Replace newlines and control characters with a space
  return name.replace(/[\r\n\x00-\x1F\x7F]+/g, ' ').trim();
}

/**
 * Clean card name for Forge:
 * - Strip set codes (e.g., "Sol Ring|2XM" -> "Sol Ring")
 * - Handle double-faced cards (keep as-is, Forge uses "CardName // BackName")
 * - Sanitize to prevent injection
 */
function cleanCardName(name: string): string {
  // Remove set code suffix (pipe notation like "Sol Ring|2XM")
  const pipeIndex = name.indexOf('|');
  if (pipeIndex !== -1) {
    name = name.substring(0, pipeIndex);
  }

  // Replace newlines and control characters with a space to prevent injection
  name = name.replace(/[\r\n\x00-\x1F\x7F]+/g, ' ');

  // Trim whitespace
  return name.trim();
}
