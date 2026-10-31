import { useCallback, useMemo, useState, type ReactNode } from 'react';
import type { LibraryDeck } from '../api';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useSetCodes } from '../hooks/useSetCodes';
import type { ScryfallCard } from '../scryfall';
import type { DeckSection } from '../utils/deck-order';
import { CardImageDialog } from './CardImageDialog';
import { READABLE_PREVIEW_WIDTH, useCardPreview } from './CardPreview';
import { DeckCard } from './DeckCard';
import { DeckRow } from './DeckRow';

interface DeckPickerProps {
  sections: DeckSection[];
  /** The deck's commander card, from `useCommanderCards`. */
  commanderOf: (deck: LibraryDeck) => ScryfallCard | undefined;
  selectedIds: string[];
  onToggle: (deckId: string) => void;
  /** Small buttons for one deck, such as its source link or Delete. */
  renderActions?: (deck: LibraryDeck) => ReactNode;
}

/** Tailwind's `sm` breakpoint: below it decks are compact rows, above it full cards. */
const WIDE_QUERY = '(min-width: 640px)';

/**
 * Decks to pick from, in sections. Wide screens get a grid of commander
 * cards (hover to enlarge); phones get compact rows (tap the art to see the
 * card).
 */
export function DeckPicker({ sections, commanderOf, selectedIds, onToggle, renderActions }: DeckPickerProps) {
  const isWide = useMediaQuery(WIDE_QUERY);
  const { previewHandlers, previewElement } = useCardPreview(READABLE_PREVIEW_WIDTH);
  const [viewedCard, setViewedCard] = useState<ScryfallCard | null>(null);
  const closeCard = useCallback(() => setViewedCard(null), []);
  const setCodeOf = useSetCodes();
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  return (
    <div className="flex flex-col gap-6">
      {sections
        .filter((s) => s.decks.length > 0)
        .map((section) => {
          const code = setCodeOf(section.setName);
          const year = section.releasedAt?.slice(0, 4);
          const detail = [code, year].filter(Boolean).join(' · ');
          return (
            <section key={section.title} aria-label={section.title}>
              <h3 className="mb-2 flex items-baseline gap-2 text-sm font-semibold text-fg">
                {section.title}
                {detail && <span className="font-mono text-xs font-normal text-fg-muted">{detail}</span>}
              </h3>
              <ul
                className={
                  isWide
                    ? 'grid grid-cols-[repeat(auto-fill,minmax(176px,1fr))] gap-3'
                    : 'grid grid-cols-1 gap-2'
                }
              >
                {section.decks.map((deck) => {
                  const shared = {
                    deck,
                    setCode: deck.isPrecon ? setCodeOf(deck.setName) : null,
                    commander: commanderOf(deck),
                    selected: selected.has(deck.id),
                    onToggle,
                    actions: renderActions?.(deck),
                  };
                  return isWide ? (
                    <DeckCard key={deck.id} {...shared} previewHandlers={previewHandlers} />
                  ) : (
                    <DeckRow key={deck.id} {...shared} onViewCard={setViewedCard} />
                  );
                })}
              </ul>
            </section>
          );
        })}
      {previewElement}
      <CardImageDialog card={viewedCard} onClose={closeCard} />
    </div>
  );
}
