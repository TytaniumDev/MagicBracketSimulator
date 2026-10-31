import { useCallback, useMemo } from 'react';
import type { LibraryDeck } from '../api';
import type { DeckTileTarget } from '../utils/deck-tile';
import { DeckGrid, type DeckGridProps } from './DeckGrid';

interface DeckPickerProps extends Omit<DeckGridProps, 'targetOf'> {
  selectedIds: string[];
  onToggle: (deckId: string) => void;
}

/** A `DeckGrid` where clicking a deck selects it or clears it. */
export function DeckPicker({ selectedIds, onToggle, ...grid }: DeckPickerProps) {
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const targetOf = useCallback(
    (deck: LibraryDeck): DeckTileTarget => ({ kind: 'select', selected: selected.has(deck.id), onToggle }),
    [selected, onToggle],
  );
  return <DeckGrid {...grid} targetOf={targetOf} />;
}
