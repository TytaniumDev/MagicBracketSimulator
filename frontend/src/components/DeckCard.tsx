import { tileStateClass } from '../utils/deck-tile';
import type { useCardPreview } from './CardPreview';
import { CommanderCardImage } from './CommanderCardImage';
import { DeckTileHeader, type DeckTileProps } from './DeckTileHeader';
import { ColorBar } from './ui/ColorBar';

interface DeckCardProps extends DeckTileProps {
  previewHandlers: ReturnType<typeof useCardPreview>['previewHandlers'];
}

/** A deck in the grid: name and colors over the commander's full card. Hover enlarges the card. */
export function DeckCard({ commander, dimmed, previewHandlers, ...header }: DeckCardProps) {
  return (
    <li
      {...previewHandlers(commander?.name ?? '', commander?.imageUrl)}
      className={`group relative flex flex-col rounded-[10px] border bg-surface transition-colors ${tileStateClass(header.target, dimmed)}`}
    >
      <div className="flex flex-col gap-2 px-3 pt-2.5 pb-2">
        <DeckTileHeader {...header} />
        <ColorBar colorIdentity={header.deck.colorIdentity} />
      </div>
      <div className="px-3 pb-3">
        <CommanderCardImage card={commander} name={header.deck.primaryCommander} />
      </div>
    </li>
  );
}
