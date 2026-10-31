import type { LibraryDeck } from '../api';

/** A tile's tooltip: the full deck name (it may be truncated) plus its set or owner. */
export function deckTooltip(deck: LibraryDeck): string {
  const detail = deck.isPrecon ? deck.setName : deck.ownerEmail && `added by ${deck.ownerEmail}`;
  return detail ? `${deck.name} · ${detail}` : deck.name;
}

/** Border for a deck tile in the picker: accent when selected. */
export function tileBorderClass(selected: boolean): string {
  return selected ? 'border-accent ring-1 ring-accent' : 'border-line hover:border-line-strong';
}
