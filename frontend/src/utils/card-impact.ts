import type { CardImpact } from '@shared/types/card-impact';

/** Below this many casts a card's lift is mostly noise, so it isn't ranked. */
export const MIN_CASTS_TO_RANK = 5;
export const TOP_SWING_LIMIT = 10;

/**
 * The cards that most often end games quickly once they land: highest
 * close lift first, among cards cast often enough to judge. Lands are left
 * out (a land "closing" games just means the deck kept playing lands).
 */
export function topSwingCards(
  cards: CardImpact[],
  isLand: (name: string) => boolean,
  limit = TOP_SWING_LIMIT,
): CardImpact[] {
  return cards
    .filter((c) => c.cast >= MIN_CASTS_TO_RANK && !isLand(c.name))
    .sort((a, b) => b.closeLift - a.closeLift || b.winLift - a.winLift)
    .slice(0, limit);
}

const PERMANENT_TYPES = ['Creature', 'Planeswalker', 'Artifact', 'Enchantment', 'Battle', 'Land'];

/** Whether a card stays on the battlefield, so "answered" means something for it. */
export function isPermanent(typeLine: string): boolean {
  const front = typeLine.split(' // ')[0];
  return PERMANENT_TYPES.some((t) => front.includes(t));
}

/** A -1..1 lift as signed percentage points, e.g. "+18 pts". */
export function formatLift(lift: number): string {
  const pts = Math.round(lift * 100);
  return `${pts > 0 ? '+' : ''}${pts} pts`;
}
