/**
 * Parse the card lines of a Forge .dck file into a decklist.
 *
 * .dck sections look like:
 *   [metadata]
 *   Name=Temur Roar Upgraded
 *   [commander]
 *   1 Ureni of the Unwritten
 *   [main]
 *   1 Sol Ring|C21|263
 *
 * Card lines are "<qty> <name>" with an optional "|SET|collector" suffix,
 * which becomes the card's printing (set codes lower-cased, as Scryfall uses).
 * Sections other than [commander] and [main] (e.g. [sideboard]) are ignored.
 */
import type { DeckCard } from '@shared/types/deck';

export interface DckCards {
  commanders: DeckCard[];
  main: DeckCard[];
}

const CARD_LINE = /^(\d+)\s*(?:x\s+)?(.+)$/i;

function parseCardLine(line: string): DeckCard | null {
  const match = CARD_LINE.exec(line);
  if (!match) return null;
  const [rawName, rawSet, rawCollector] = match[2].split('|').map((part) => part.trim());
  if (!rawName) return null;
  const card: DeckCard = { quantity: parseInt(match[1], 10), name: rawName };
  if (rawSet) {
    card.setCode = rawSet.toLowerCase();
    if (rawCollector) card.collectorNumber = rawCollector;
  }
  return card;
}

export function parseDckCards(dck: string): DckCards {
  const result: DckCards = { commanders: [], main: [] };
  let section: DeckCard[] | null = null;

  for (const raw of dck.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith('[') && line.endsWith(']')) {
      const name = line.slice(1, -1).toLowerCase();
      section = name === 'commander' ? result.commanders : name === 'main' ? result.main : null;
      continue;
    }

    if (!section) continue;
    const card = parseCardLine(line);
    if (card) section.push(card);
  }

  return result;
}
