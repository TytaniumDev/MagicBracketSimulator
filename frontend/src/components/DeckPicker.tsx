import { useCallback, useMemo, useState, type ReactNode } from 'react';
import type { LibraryDeck } from '../api';
import { useScryfallCards } from '../hooks/useDeck';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useSetCodes } from '../hooks/useSetCodes';
import { cardKey, type ScryfallCard } from '../scryfall';
import { CardImageDialog } from './CardImageDialog';
import { useCardPreview } from './CardPreview';
import { DeckCard } from './DeckCard';
import { DeckRow } from './DeckRow';

export interface DeckPickerGroup {
  title: string;
  decks: LibraryDeck[];
}

interface DeckPickerProps {
  groups: DeckPickerGroup[];
  selectedIds: string[];
  onToggle: (deckId: string) => void;
  /** Small buttons for one deck, such as its source link or Delete. */
  renderActions?: (deck: LibraryDeck) => ReactNode;
}

/** Tailwind's `sm` breakpoint: below it decks are compact rows, above it full cards. */
const WIDE_QUERY = '(min-width: 640px)';
/** Big enough to read a card's rules text. */
const HOVER_PREVIEW_WIDTH = 320;

/**
 * Decks to pick from, in groups. Wide screens get a grid of commander cards
 * (hover to enlarge); phones get compact rows (tap the art to see the card).
 */
export function DeckPicker({ groups, selectedIds, onToggle, renderActions }: DeckPickerProps) {
  const isWide = useMediaQuery(WIDE_QUERY);
  const { previewHandlers, previewElement } = useCardPreview(HOVER_PREVIEW_WIDTH);
  const [viewedCard, setViewedCard] = useState<ScryfallCard | null>(null);
  const closeCard = useCallback(() => setViewedCard(null), []);

  const commanderNames = useMemo(
    () => [...new Set(groups.flatMap((g) => g.decks.map((d) => d.primaryCommander).filter((n): n is string => !!n)))],
    [groups],
  );
  const { data: lookup } = useScryfallCards(commanderNames);
  const setCodeOf = useSetCodes();
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  return (
    <div className="flex flex-col gap-6">
      {groups
        .filter((g) => g.decks.length > 0)
        .map((group) => (
          <section key={group.title} aria-label={group.title}>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-muted">{group.title}</h3>
            <ul
              className={
                isWide
                  ? 'grid grid-cols-[repeat(auto-fill,minmax(176px,1fr))] gap-3'
                  : 'grid grid-cols-1 gap-2'
              }
            >
              {group.decks.map((deck) => {
                const commander = deck.primaryCommander ? lookup?.[cardKey(deck.primaryCommander)] : undefined;
                const shared = {
                  deck,
                  setCode: deck.isPrecon ? setCodeOf(deck.setName) : null,
                  commander,
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
        ))}
      {previewElement}
      <CardImageDialog card={viewedCard} onClose={closeCard} />
    </div>
  );
}
