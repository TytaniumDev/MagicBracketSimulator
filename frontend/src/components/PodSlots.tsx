import type { LibraryDeck } from '../api';
import type { ScryfallCard } from '../scryfall';
import { slotCount } from '../utils/pods';
import { REQUIRED_DECK_COUNT } from '@shared/types/job';
import { READABLE_PREVIEW_WIDTH, useCardPreview } from './CardPreview';
import { XIcon } from './ui/icons';

interface PodSlotsProps {
  /** Selected decks, in the order they were picked. */
  decks: LibraryDeck[];
  commanderOf: (deck: LibraryDeck) => ScryfallCard | undefined;
  onRemove: (deckId: string) => void;
}

/**
 * Four seats that fill as decks are picked. Once a pod is full, one more
 * empty slot shows that up to ten decks can be picked for a pod run.
 * Hovering a filled slot shows the commander's card.
 */
export function PodSlots({ decks, commanderOf, onRemove }: PodSlotsProps) {
  const { previewHandlers, previewElement } = useCardPreview(READABLE_PREVIEW_WIDTH);

  return (
    <>
      <ul className="flex min-w-0 flex-1 gap-2 overflow-x-auto p-0.5" aria-label="Selected decks">
        {Array.from({ length: slotCount(decks.length) }, (_, i) => {
          const deck = decks[i];
          if (!deck) {
            return (
              <li
                key={`empty-${i}`}
                className="grid h-14 w-24 shrink-0 place-items-center rounded-lg border border-dashed border-line-strong text-xs text-fg-muted sm:w-28"
              >
                {i < REQUIRED_DECK_COUNT ? `Seat ${i + 1}` : '+ Deck'}
              </li>
            );
          }
          const commander = commanderOf(deck);
          return (
            <li
              key={deck.id}
              {...previewHandlers(commander?.name ?? '', commander?.imageUrl)}
              style={commander?.artCropUrl ? { backgroundImage: `url("${commander.artCropUrl}")` } : undefined}
              className="relative h-14 w-24 shrink-0 overflow-hidden rounded-lg border border-accent bg-surface-raised bg-cover bg-[center_25%] sm:w-28"
            >
              <span className="absolute inset-0 bg-gradient-to-b from-transparent from-30% to-black/85" />
              <span className="absolute inset-x-1.5 bottom-1 truncate text-xs font-semibold text-white" title={deck.name}>
                {deck.name}
              </span>
              <button
                type="button"
                onClick={() => onRemove(deck.id)}
                aria-label={`Remove ${deck.name}`}
                className="absolute top-1 right-1 grid h-5 w-5 place-items-center rounded-full bg-black/60 text-white hover:bg-black/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <XIcon className="h-3 w-3" />
              </button>
            </li>
          );
        })}
      </ul>
      {previewElement}
    </>
  );
}
