const WUBRG_ORDER = ['W', 'U', 'B', 'R', 'G'] as const;

export type ManaColor = (typeof WUBRG_ORDER)[number] | 'C';

export const MANA_COLOR_LABEL: Record<ManaColor, string> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
  C: 'Colorless',
};

/** A deck's colors in WUBRG order; a deck with none is colorless. */
export function deckColors(colorIdentity?: string[]): ManaColor[] {
  const present = WUBRG_ORDER.filter((c) => colorIdentity?.includes(c));
  return present.length ? present : ['C'];
}
