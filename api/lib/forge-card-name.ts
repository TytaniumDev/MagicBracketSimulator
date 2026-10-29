/**
 * Card names in the form Forge's deck loader accepts.
 *
 * Moxfield, Archidekt and friends write two-part cards as "Front // Back".
 * Forge only knows split cards (Fire // Ice) by that joined name; adventure,
 * omen, modal double-faced, transform and flip cards are known by their
 * front face alone, and "Whirlwing Stormbrood // Dynamic Soar" is dropped
 * from the deck with an "unsupported card" warning. The front face works for
 * every layout, split cards included (checked against Forge 2.0.15), so
 * that's what we hand Forge.
 */

const FACE_SEPARATOR = ' // ';

/** Front face of a card name: "Brazen Borrower // Petty Theft" → "Brazen Borrower". */
export function forgeCardName(name: string): string {
  const separator = name.indexOf(FACE_SEPARATOR);
  return (separator === -1 ? name : name.slice(0, separator)).trim();
}

/** "1 Name // Back|SET|123" card lines in a .dck file. */
const DCK_CARD_LINE = /^(\s*\d+x?\s+)([^|]+)(.*)$/;

/**
 * Rewrite every card line of a .dck file to use `forgeCardName`, leaving
 * section headers, metadata and set suffixes alone. Decks saved before this
 * existed still have joined names, so this runs whenever a deck is read.
 */
export function normalizeDckForForge(dck: string): string {
  if (!dck.includes(FACE_SEPARATOR)) return dck;
  return dck
    .split('\n')
    .map((line) => {
      const match = DCK_CARD_LINE.exec(line);
      if (!match || !match[2].includes(FACE_SEPARATOR)) return line;
      return `${match[1]}${forgeCardName(match[2])}${match[3]}`;
    })
    .join('\n');
}
