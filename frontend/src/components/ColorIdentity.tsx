import { memo } from 'react';

const WUBRG_ORDER = ['W', 'U', 'B', 'R', 'G'] as const;
const MANA_SYMBOL_SVG: Record<string, string> = {
  W: 'https://svgs.scryfall.io/card-symbols/W.svg',
  U: 'https://svgs.scryfall.io/card-symbols/U.svg',
  B: 'https://svgs.scryfall.io/card-symbols/B.svg',
  R: 'https://svgs.scryfall.io/card-symbols/R.svg',
  G: 'https://svgs.scryfall.io/card-symbols/G.svg',
};
const MANA_LABELS: Record<string, string> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
};

interface ColorIdentityProps {
  colorIdentity?: string[];
  className?: string;
}

// Memoized to prevent re-renders in large lists (e.g. deck lists) when parent re-renders but props are unchanged.
export const ColorIdentity = memo(function ColorIdentity({ colorIdentity, className = '' }: ColorIdentityProps) {
  if (!colorIdentity?.length) return null;
  const present = WUBRG_ORDER.filter((c) => colorIdentity.includes(c));
  return (
    <span
      className={`flex items-center gap-0.5 shrink-0 ${className}`.trim()}
      role="img"
      aria-label={present.map((c) => MANA_LABELS[c]).join(', ')}
    >
      {present.map((c) => (
        <img
          key={c}
          src={MANA_SYMBOL_SVG[c]}
          alt={MANA_LABELS[c]}
          title={MANA_LABELS[c]}
          className="w-4 h-4 object-contain"
        />
      ))}
    </span>
  );
});
