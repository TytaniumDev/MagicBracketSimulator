import type { DeckCard } from '@shared/types/deck';
import { cardKey, type ScryfallCard } from '../scryfall';

export interface CardGroup {
  label: string;
  cards: DeckCard[];
  /** Total copies in the group (a "10 Forest" line counts 10). */
  count: number;
}

/**
 * Display order for type groups. A card goes in the first group whose type
 * appears in its type line, so an Artifact Creature is a Creature and a land
 * creature (Dryad Arbor) is a Land.
 */
const TYPE_ORDER = [
  'Land',
  'Creature',
  'Planeswalker',
  'Battle',
  'Instant',
  'Sorcery',
  'Artifact',
  'Enchantment',
] as const;

const PLURAL: Record<(typeof TYPE_ORDER)[number], string> = {
  Land: 'Lands',
  Creature: 'Creatures',
  Planeswalker: 'Planeswalkers',
  Battle: 'Battles',
  Instant: 'Instants',
  Sorcery: 'Sorceries',
  Artifact: 'Artifacts',
  Enchantment: 'Enchantments',
};

const DISPLAY_ORDER = [
  'Creature',
  'Planeswalker',
  'Battle',
  'Instant',
  'Sorcery',
  'Artifact',
  'Enchantment',
  'Land',
] as const;

const OTHER_LABEL = 'Other';

export function primaryType(typeLine: string): (typeof TYPE_ORDER)[number] | null {
  // Only the front face of a double-faced card decides its group.
  const front = typeLine.split(' // ')[0];
  return TYPE_ORDER.find((t) => front.includes(t)) ?? null;
}

/**
 * Group a main deck by card type, each group sorted by mana value then name.
 * Cards without Scryfall data (still loading, or unknown) go in "Other".
 */
export function groupDeckCards(
  cards: DeckCard[],
  lookup: Record<string, ScryfallCard> | undefined,
): CardGroup[] {
  const buckets = new Map<string, DeckCard[]>();
  for (const card of cards) {
    const info = lookup?.[cardKey(card.name)];
    const type = info ? primaryType(info.typeLine) : null;
    const label = type ? PLURAL[type] : OTHER_LABEL;
    const bucket = buckets.get(label) ?? [];
    bucket.push(card);
    buckets.set(label, bucket);
  }

  const manaValue = (card: DeckCard) => lookup?.[cardKey(card.name)]?.manaValue ?? 0;
  const labels = [...DISPLAY_ORDER.map((t) => PLURAL[t]), OTHER_LABEL];

  return labels
    .filter((label) => buckets.has(label))
    .map((label) => {
      const groupCards = [...buckets.get(label)!].sort(
        (a, b) => manaValue(a) - manaValue(b) || a.name.localeCompare(b.name),
      );
      return {
        label,
        cards: groupCards,
        count: groupCards.reduce((sum, c) => sum + c.quantity, 0),
      };
    });
}
