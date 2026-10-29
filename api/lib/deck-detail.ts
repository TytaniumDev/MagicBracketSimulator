/**
 * Builds the deck page response from the deck library and the deck's
 * rating. A deck that left the library (e.g. a precon the Archidekt sync
 * removed) still has results on the leaderboard, so it gets a page built
 * from the rating's denormalized metadata, without a decklist.
 */
import { parseDckCards } from './dck-cards';
import { toDeckStats } from './deck-stats';
import type { DeckListItem } from './deck-store-factory';
import type { DeckRating } from './types';
import type { DeckDetailResponse } from '@shared/types/deck';

/** The deck page response, or null when nothing at all is known about `id`. */
export function buildDeckDetail(
  id: string,
  deck: DeckListItem | null,
  content: { dck: string } | null,
  rating: DeckRating | null,
): DeckDetailResponse | null {
  const stats = rating && rating.gamesPlayed > 0 ? toDeckStats(rating) : null;

  if (deck && content) {
    const { commanders, main } = parseDckCards(content.dck);
    return {
      deck: {
        id: deck.id,
        name: deck.name,
        primaryCommander: deck.primaryCommander ?? null,
        colorIdentity: deck.colorIdentity ?? [],
        isPrecon: deck.isPrecon,
        setName: deck.setName ?? null,
        link: deck.link ?? null,
      },
      decklistAvailable: true,
      commanders,
      cards: main,
      stats,
    };
  }

  if (!rating?.deckName) return null;
  return {
    deck: {
      id,
      name: rating.deckName,
      primaryCommander: rating.primaryCommander ?? null,
      colorIdentity: [],
      isPrecon: rating.isPrecon ?? false,
      setName: rating.setName ?? null,
      link: null,
    },
    decklistAvailable: false,
    commanders: [],
    cards: [],
    stats,
  };
}
