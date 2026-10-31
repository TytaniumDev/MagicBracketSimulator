import type { ReactNode } from 'react';
import type { LibraryDeck } from '../api';
import { deckTooltip } from '../utils/deck-tile';

export interface DeckTileHeaderProps {
  deck: LibraryDeck;
  /** Short set code ("TDM") shown after a precon's name; null when unknown. */
  setCode: string | null;
  selected: boolean;
  onToggle: (deckId: string) => void;
  /** Small buttons beside the deck name, such as its source link. */
  actions?: ReactNode;
}

/**
 * A picker tile's deck name and actions. The checkbox's ::after stretches
 * over the whole tile (the nearest positioned ancestor), so clicking
 * anywhere selects the deck, while `actions` sit above it and stay
 * clickable on their own.
 */
export function DeckTileHeader({ deck, setCode, selected, onToggle, actions }: DeckTileHeaderProps) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        aria-label={`Select deck ${deck.name}`}
        onClick={() => onToggle(deck.id)}
        title={deckTooltip(deck)}
        className="min-w-0 flex-1 text-left after:absolute after:inset-0 after:rounded-[10px] focus:outline-none focus-visible:after:ring-2 focus-visible:after:ring-accent"
      >
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate text-sm font-semibold text-fg">{deck.name}</span>
          {setCode && <span className="shrink-0 font-mono text-[11px] text-fg-muted">{setCode}</span>}
        </span>
      </button>
      {actions && <div className="relative z-10 flex items-center">{actions}</div>}
    </div>
  );
}
