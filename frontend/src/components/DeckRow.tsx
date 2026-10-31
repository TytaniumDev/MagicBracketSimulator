import type { ScryfallCard } from '../scryfall';
import { tileBorderClass } from '../utils/deck-tile';
import { DeckTileHeader, type DeckTileHeaderProps } from './DeckTileHeader';
import { ColorBar } from './ui/ColorBar';
import { ExpandIcon } from './ui/icons';

interface DeckRowProps extends DeckTileHeaderProps {
  /** Scryfall data for the deck's commander; undefined while loading or unknown. */
  commander: ScryfallCard | undefined;
  /** Show the commander's full card (tapping the art). */
  onViewCard: (card: ScryfallCard) => void;
}

/** A deck in the phone picker list: commander art beside the name and colors. */
export function DeckRow({ commander, onViewCard, ...header }: DeckRowProps) {
  return (
    <li
      className={`group relative grid grid-cols-[64px_1fr] overflow-hidden rounded-[10px] border bg-surface transition-colors ${tileBorderClass(header.selected)}`}
    >
      {commander?.imageUrl ? (
        <button
          type="button"
          onClick={() => onViewCard(commander)}
          aria-label={`View ${commander.name}`}
          style={commander.artCropUrl ? { backgroundImage: `url("${commander.artCropUrl}")` } : undefined}
          className="relative z-10 row-span-2 min-h-16 bg-surface-raised bg-cover bg-[center_25%] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
        >
          <span className="absolute right-1 bottom-1 grid h-4 w-4 place-items-center rounded bg-black/70 text-white">
            <ExpandIcon className="h-2.5 w-2.5" />
          </span>
        </button>
      ) : (
        <div className="row-span-2 min-h-16 bg-surface-raised" />
      )}
      <div className="min-w-0 px-3 pt-2.5 pb-1.5">
        <DeckTileHeader {...header} />
      </div>
      <div className="px-3 pb-2.5">
        <ColorBar colorIdentity={header.deck.colorIdentity} />
      </div>
    </li>
  );
}
