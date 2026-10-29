import { memo } from 'react';

const SYMBOL_PATTERN = /\{([^}]+)\}/g;

/** Scryfall's symbol SVGs drop the slash from hybrid symbols: {G/U} → GU.svg. */
function symbolUrl(symbol: string): string {
  return `https://svgs.scryfall.io/card-symbols/${symbol.replace('/', '')}.svg`;
}

/** Render a Scryfall mana cost string like "{2}{G}{U}" as symbol icons. */
export const ManaCost = memo(function ManaCost({ cost }: { cost: string }) {
  const symbols = [...cost.matchAll(SYMBOL_PATTERN)].map((m) => m[1]);
  if (symbols.length === 0) return null;
  return (
    <span className="inline-flex items-center gap-px shrink-0" aria-label={cost}>
      {symbols.map((symbol, i) => (
        <img key={i} src={symbolUrl(symbol)} alt="" className="w-3.5 h-3.5" loading="lazy" />
      ))}
    </span>
  );
});
