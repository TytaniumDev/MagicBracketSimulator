import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { LibraryDeck } from '../api';
import type { ScryfallCard } from '../scryfall';
import { deckTooltip, type DeckTileTarget } from '../utils/deck-tile';
import { MarqueeText } from './ui/MarqueeText';

export interface DeckTileHeaderProps {
  deck: LibraryDeck;
  /** Short set code ("TDM") shown at the right of a precon's name line; null when unknown. */
  setCode: string | null;
  target: DeckTileTarget;
  /** Small buttons beside the deck name, such as its source link. */
  actions?: ReactNode;
}

/** Everything a deck tile (`DeckCard`, `DeckRow`) takes besides its layout's own props. */
export interface DeckTileProps extends DeckTileHeaderProps {
  /** Scryfall data for the deck's commander; undefined while loading or unknown. */
  commander: ScryfallCard | undefined;
  /** Draw the tile faded, such as a deck excluded from selection. */
  dimmed?: boolean;
}

// The ::after stretches over the whole tile (the nearest positioned ancestor).
const STRETCHED_CLASS =
  'min-w-0 flex-1 text-left after:absolute after:inset-0 after:rounded-[10px] focus:outline-none focus-visible:after:ring-2 focus-visible:after:ring-accent';

/**
 * A deck tile's name and actions. The name is the tile's target (a checkbox
 * or a link) and stretches over the whole tile, so clicking anywhere selects
 * or opens the deck, while `actions` sit above it and stay clickable on
 * their own.
 */
export function DeckTileHeader({ deck, setCode, target, actions }: DeckTileHeaderProps) {
  const name = (
    <span className="flex min-w-0 items-baseline gap-2">
      <MarqueeText text={deck.name} className="flex-1 text-sm font-semibold text-fg" />
      {setCode && <span className="shrink-0 font-mono text-[11px] text-fg-muted">{setCode}</span>}
    </span>
  );
  return (
    <div className="flex min-w-0 items-center gap-1">
      {target.kind === 'select' ? (
        <button
          type="button"
          role="checkbox"
          aria-checked={target.selected}
          aria-label={`Select deck ${deck.name}`}
          onClick={() => target.onToggle(deck.id)}
          title={deckTooltip(deck)}
          className={STRETCHED_CLASS}
        >
          {name}
        </button>
      ) : (
        <Link to={target.to} title={deckTooltip(deck)} className={STRETCHED_CLASS}>
          {name}
        </Link>
      )}
      {actions && <div className="relative z-10 flex items-center">{actions}</div>}
    </div>
  );
}
