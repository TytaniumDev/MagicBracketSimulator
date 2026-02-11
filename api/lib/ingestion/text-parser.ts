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
 * - Commander appears at the end, separated by blank line
 * - With sideboard: mainboard, SIDEBOARD:, sideboard cards, blank line, commander(s)
 * - Without sideboard: mainboard, blank line, commander(s)
 */
export function parseTextDeck(text: string, deckName: string = 'Imported Deck'): ParsedDeck {
  const lines = text.split(/\r?\n/);
  const commanders: DeckCard[] = [];
  const mainboard: DeckCard[] = [];
  const sideboard: DeckCard[] = [];
  // Track cards after the last blank line (potential Moxfield commander location)
  let cardsAfterLastBlank: DeckCard[] = [];

  let currentSection: 'commander' | 'main' | 'sideboard' = 'main';
  let sawBlankInCurrentSection = false;
  let hasSideboard = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();

    // Track blank lines to detect Moxfield commander format
    if (!line) {
      if (currentSection !== 'commander') {
        sawBlankInCurrentSection = true;
        // Reset cards after blank - we only care about the LAST group after a blank
        cardsAfterLastBlank = [];
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
        hasSideboard = true;
        sawBlankInCurrentSection = false;
        cardsAfterLastBlank = [];
      } else {
        currentSection = 'main';
      }
      continue;
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
          if (sawBlankInCurrentSection) {
            // Cards after blank in sideboard section - potential commander
            cardsAfterLastBlank.push(card);
          } else {
            sideboard.push(card);
          }
          break;
        default:
          if (sawBlankInCurrentSection && !hasSideboard) {
            // Cards after blank in main section (no sideboard) - potential commander
            cardsAfterLastBlank.push(card);
          } else {
            mainboard.push(card);
          }
      }
    }
  }

  // Moxfield MTGO format: if we have 1-2 cards after the last blank line and no explicit commanders,
  // treat those as commanders (this is where Moxfield puts the commander)
  if (commanders.length === 0 && cardsAfterLastBlank.length > 0 && cardsAfterLastBlank.length <= 2) {
    for (const card of cardsAfterLastBlank) {
      card.isCommander = true;
      commanders.push(card);
    }
  } else {
    // Otherwise add them to mainboard (they weren't commanders)
    mainboard.push(...cardsAfterLastBlank);
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
