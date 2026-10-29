import { memo, useMemo } from 'react';
import type { DeckCard } from '@shared/types/deck';
import { cardKey, type ScryfallCard } from '../scryfall';
import { groupDeckCards } from '../utils/card-groups';
import { useCardPreview } from './CardPreview';
import { CardName } from './CardName';
import { ManaCost } from './ManaCost';

interface CardRowProps {
  card: DeckCard;
  info: ScryfallCard | undefined;
  previewHandlers: ReturnType<typeof useCardPreview>['previewHandlers'];
}

function CardRow({ card, info, previewHandlers }: CardRowProps) {
  return (
    <li>
      <CardName
        name={card.name}
        info={info}
        previewHandlers={previewHandlers}
        className="w-full flex items-center gap-2 px-1.5 py-0.5 rounded text-left text-sm text-gray-200 hover:bg-gray-700/60 focus:bg-gray-700/60 focus:outline-none"
      >
        <span className="w-5 shrink-0 text-right text-xs text-gray-500 tabular-nums">
          {card.quantity > 1 ? card.quantity : ''}
        </span>
        <span className="flex-1 min-w-0 truncate">{card.name}</span>
        {info && <ManaCost cost={info.manaCost} />}
      </CardName>
    </li>
  );
}

interface DeckListProps {
  commanders: DeckCard[];
  cards: DeckCard[];
  /** Scryfall data keyed by `cardKey`; undefined while loading. */
  lookup: Record<string, ScryfallCard> | undefined;
}

/**
 * Compact decklist grouped by card type. Hovering (or focusing) a card shows
 * its full image beside the list; clicking opens it on Scryfall.
 */
export const DeckList = memo(function DeckList({ commanders, cards, lookup }: DeckListProps) {
  const { previewHandlers, previewElement } = useCardPreview();
  const groups = useMemo(() => {
    const byType = groupDeckCards(cards, lookup);
    return commanders.length > 0
      ? [{ label: commanders.length > 1 ? 'Commanders' : 'Commander', cards: commanders, count: commanders.length }, ...byType]
      : byType;
  }, [commanders, cards, lookup]);

  return (
    <>
      <div className="columns-1 sm:columns-2 lg:columns-3 gap-6">
        {groups.map((group) => (
          <section key={group.label} className="break-inside-avoid mb-4">
            <h3 className="px-1.5 mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
              {group.label} <span className="text-gray-600">({group.count})</span>
            </h3>
            <ul>
              {group.cards.map((card) => (
                <CardRow
                  key={card.name}
                  card={card}
                  info={lookup?.[cardKey(card.name)]}
                  previewHandlers={previewHandlers}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
      {previewElement}
    </>
  );
});
