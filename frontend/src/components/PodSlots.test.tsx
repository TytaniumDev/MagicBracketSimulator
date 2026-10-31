import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { LibraryDeck } from '../api';
import { PodSlots } from './PodSlots';

const deck = (id: string): LibraryDeck => ({ id, name: `Deck ${id}`, filename: `${id}.dck`, isPrecon: true, ownerId: null });
const noCommander = () => undefined;

describe('PodSlots', () => {
  it('shows four empty seats before any deck is picked', () => {
    render(<PodSlots decks={[]} commanderOf={noCommander} onRemove={() => {}} />);
    const slots = screen.getAllByRole('listitem');
    expect(slots.map((s) => s.textContent)).toEqual(['Seat 1', 'Seat 2', 'Seat 3', 'Seat 4']);
  });

  it('adds a spare slot once the pod is full', () => {
    render(<PodSlots decks={['a', 'b', 'c', 'd'].map(deck)} commanderOf={noCommander} onRemove={() => {}} />);
    const slots = screen.getAllByRole('listitem');
    expect(slots).toHaveLength(5);
    expect(slots[4]).toHaveTextContent('+ Deck');
  });

  it('removes a deck from its slot', () => {
    const onRemove = vi.fn();
    render(<PodSlots decks={[deck('a')]} commanderOf={noCommander} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Deck a' }));
    expect(onRemove).toHaveBeenCalledWith('a');
  });
});
