import type { LibraryDeck } from '../api';

/** What clicking anywhere on a deck tile does: select the deck, or open a page. */
export type DeckTileTarget =
  | { kind: 'select'; selected: boolean; onToggle: (deckId: string) => void }
  | { kind: 'link'; to: string };

/** A tile's tooltip: the full deck name (it may be truncated) plus its set or owner. */
export function deckTooltip(deck: LibraryDeck): string {
  const detail = deck.isPrecon ? deck.setName : deck.ownerEmail && `added by ${deck.ownerEmail}`;
  return detail ? `${deck.name} · ${detail}` : deck.name;
}

/** Border and fade for a deck tile: accent when selected, faded when dimmed. */
export function tileStateClass(target: DeckTileTarget, dimmed = false): string {
  const border =
    target.kind === 'select' && target.selected
      ? 'border-accent ring-1 ring-accent'
      : 'border-line hover:border-line-strong';
  return dimmed ? `${border} opacity-50` : border;
}
