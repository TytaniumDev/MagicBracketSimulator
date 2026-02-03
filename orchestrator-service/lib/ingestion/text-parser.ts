import { ParsedDeck, DeckCard } from './to-dck';

/**
 * Parse plain text deck list into a ParsedDeck
 *
 * Supported formats:
 * - "1 Sol Ring"
 * - "1x Sol Ring"
 * - "Sol Ring" (defaults to quantity 1)
 * - "1 Sol Ring (2XM)" (with set code in parens)
 *
 * Sections detected:
 * - [Commander] or COMMANDER:
 * - [Main] or MAINBOARD: or MAIN:
 * - SIDEBOARD: (ignored for Commander decks)
 * - Lines starting with "Commander:" or "1x Commander:"
 *
 * Moxfield MTGO format special handling:
 * - Commander appears after SIDEBOARD section, separated by blank line
 * - Format: mainboard, SIDEBOARD:, sideboard cards, blank line, commander(s)
 */
export function parseTextDeck(text: string, deckName: string = 'Imported Deck'): ParsedDeck {
  const lines = text.split(/\r?\n/);
  const commanders: DeckCard[] = [];
  const mainboard: DeckCard[] = [];
  const sideboard: DeckCard[] = [];
  const postSideboard: DeckCard[] = []; // Cards after sideboard section (Moxfield commander location)

  let currentSection: 'commander' | 'main' | 'sideboard' | 'post-sideboard' = 'main';
  let sawBlankAfterSideboard = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();

    // Track blank lines after sideboard to detect Moxfield commander format
    if (!line) {
      if (currentSection === 'sideboard') {
        sawBlankAfterSideboard = true;
      }
      continue;
    }

    // Skip comments
    if (line.startsWith('//') || line.startsWith('#')) {
      continue;
    }

    // Check for section headers
    const sectionMatch = line.match(/^\[?(commander|commanders|main|mainboard|deck|sideboard)\]?:?$/i);
    if (sectionMatch) {
      const section = sectionMatch[1].toLowerCase();
      if (section === 'commander' || section === 'commanders') {
        currentSection = 'commander';
      } else if (section === 'sideboard') {
        currentSection = 'sideboard';
      } else {
        currentSection = 'main';
      }
      continue;
    }

    // If we saw a blank line after sideboard, switch to post-sideboard section
    if (sawBlankAfterSideboard && currentSection === 'sideboard') {
      currentSection = 'post-sideboard';
    }

    // Check for inline commander indicator: "1x CardName *CMDR*" or "Commander: CardName"
    const commanderIndicatorMatch = line.match(/^\*?cmdr\*?:?\s*/i) ||
                                     line.match(/^commander:?\s+/i);
    if (commanderIndicatorMatch) {
      line = line.replace(commanderIndicatorMatch[0], '');
      const card = parseCardLine(line);
      if (card) {
        card.isCommander = true;
        commanders.push(card);
      }
      continue;
    }

    // Check for *CMDR* suffix
    const cmdrSuffixMatch = line.match(/\s*\*CMDR\*\s*$/i);
    if (cmdrSuffixMatch) {
      line = line.replace(cmdrSuffixMatch[0], '');
      const card = parseCardLine(line);
      if (card) {
        card.isCommander = true;
        commanders.push(card);
      }
      continue;
    }

    // Parse regular card line
    const card = parseCardLine(line);
    if (card) {
      switch (currentSection) {
        case 'commander':
          card.isCommander = true;
          commanders.push(card);
          break;
        case 'sideboard':
          sideboard.push(card);
          break;
        case 'post-sideboard':
          postSideboard.push(card);
          break;
        default:
          mainboard.push(card);
      }
    }
  }

  // Moxfield MTGO format: if we have 1-2 cards in post-sideboard section and no explicit commanders,
  // treat those as commanders (this is where Moxfield puts the commander)
  if (commanders.length === 0 && postSideboard.length > 0 && postSideboard.length <= 2) {
    for (const card of postSideboard) {
      card.isCommander = true;
      commanders.push(card);
    }
  } else {
    // Otherwise add post-sideboard to mainboard (shouldn't happen normally)
    mainboard.push(...postSideboard);
  }

  // Sideboard cards are ignored for Commander format (they're companion/sideboard slots)

  return {
    name: deckName,
    commanders,
    mainboard,
  };
}

/**
 * Parse a single card line
 * Formats:
 * - "1 Sol Ring"
 * - "1x Sol Ring"
 * - "Sol Ring" (qty = 1)
 * - "1 Sol Ring (2XM)" (strip set code)
 * - "1 Sol Ring [2XM]" (strip set code)
 */
function parseCardLine(line: string): DeckCard | null {
  line = line.trim();
  if (!line) return null;
  
  // Remove set codes in parentheses or brackets at the end
  line = line.replace(/\s*[\(\[][\w\d]+[\)\]]\s*$/, '');
  
  // Try to parse quantity
  // Pattern: "N CardName" or "Nx CardName" where N is a number
  const qtyMatch = line.match(/^(\d+)x?\s+(.+)$/i);
  
  if (qtyMatch) {
    const quantity = parseInt(qtyMatch[1], 10);
    const name = qtyMatch[2].trim();
    if (name) {
      return { name, quantity };
    }
  } else {
    // No quantity prefix - assume 1
    if (line.length > 0) {
      return { name: line, quantity: 1 };
    }
  }
  
  return null;
}

/**
 * Extract deck name from text if present
 * Looks for "Deck: Name" or "Name=" at the start
 */
export function extractDeckName(text: string): string | null {
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Check for "Deck: Name" format
    const deckMatch = trimmed.match(/^deck:?\s+(.+)$/i);
    if (deckMatch) {
      return deckMatch[1].trim();
    }
    
    // Check for "Name=DeckName" format
    const nameMatch = trimmed.match(/^name\s*=\s*(.+)$/i);
    if (nameMatch) {
      return nameMatch[1].trim();
    }
  }
  
  return null;
}

/**
 * Parse text and auto-detect deck name
 */
export function parseTextDeckWithAutoName(text: string): ParsedDeck {
  const detectedName = extractDeckName(text) || 'Imported Deck';
  return parseTextDeck(text, detectedName);
}
