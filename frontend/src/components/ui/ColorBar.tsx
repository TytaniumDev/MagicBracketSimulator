import { memo } from 'react';
import { deckColors, MANA_COLOR_LABEL, type ManaColor } from '../../utils/color-identity';

const SEGMENT_CLASS: Record<ManaColor, string> = {
  W: 'bg-mana-w',
  U: 'bg-mana-u',
  B: 'bg-mana-b',
  R: 'bg-mana-r',
  G: 'bg-mana-g',
  C: 'bg-mana-c',
};

// Kept in its own string: Tailwind can't find a class written right before
// a `${...}` in a template literal, so `gap-[3px]${...}` never got its CSS.
const BAR_CLASS = 'flex h-1.5 w-full gap-[3px]';

interface ColorBarProps {
  colorIdentity?: string[];
  className?: string;
}

/** A deck's color identity as a split bar, one block per color. */
export const ColorBar = memo(function ColorBar({ colorIdentity, className = '' }: ColorBarProps) {
  const colors = deckColors(colorIdentity);
  const label = colors.map((c) => MANA_COLOR_LABEL[c]).join(', ');
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`${BAR_CLASS}${className ? ` ${className}` : ''}`}
    >
      {colors.map((c) => (
        <span key={c} data-color={c} className={`flex-1 rounded-[2px] ${SEGMENT_CLASS[c]}`} />
      ))}
    </span>
  );
});
