import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { renderWithRouter } from '../test/render';
import Decks from './Decks';
import type { LibraryDeck } from '../api';
import { useAuth } from '../contexts/AuthContext';
import { useCommanderCards } from '../hooks/useCommanderCards';
import { useDeckLibrary, useSetDecksExcluded } from '../hooks/useDeckLibrary';
import { useSetCodes } from '../hooks/useSetCodes';

vi.mock('../contexts/AuthContext');
vi.mock('../hooks/useCommanderCards');
vi.mock('../hooks/useDeckLibrary');
vi.mock('../hooks/useSetCodes');

const deck = (overrides: Partial<LibraryDeck>): LibraryDeck => ({
  id: 'abzan-armor',
  name: 'Abzan Armor',
  filename: 'abzan-armor.dck',
  colorIdentity: ['W', 'B', 'G'],
  isPrecon: true,
  link: 'https://archidekt.com/decks/1',
  ownerId: null,
  setName: 'Tarkir: Dragonstorm',
  releasedAt: '2025-04-11',
  primaryCommander: 'Felothar the Steadfast',
  ...overrides,
});

const DECKS = [
  deck({}),
  deck({ id: 'jeskai-striker', name: 'Jeskai Striker', colorIdentity: ['U', 'R', 'W'], primaryCommander: 'Shiko and Narset, Unified' }),
];

const mutate = vi.fn();

function setup({ isAdmin = false, excludedDeckIds = [] as string[] } = {}) {
  vi.mocked(useAuth).mockReturnValue({ isAdmin } as unknown as ReturnType<typeof useAuth>);
  vi.mocked(useDeckLibrary).mockReturnValue({
    data: { decks: DECKS, excludedDeckIds, communityDecksFailed: false },
    isLoading: false,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useDeckLibrary>);
  vi.mocked(useSetDecksExcluded).mockReturnValue({
    mutate,
    isError: false,
  } as unknown as ReturnType<typeof useSetDecksExcluded>);
  vi.mocked(useCommanderCards).mockReturnValue((d) =>
    d.primaryCommander ? { name: d.primaryCommander, imageUrl: `https://img/${d.id}.jpg` } as ReturnType<ReturnType<typeof useCommanderCards>> : undefined,
  );
  vi.mocked(useSetCodes).mockReturnValue((setName) => (setName === 'Tarkir: Dragonstorm' ? 'TDM' : null));
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  return renderWithRouter(<Decks />, { route: '/decks', routePath: '/decks' });
}

describe('Decks page', () => {
  beforeEach(() => {
    mutate.mockClear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows each deck as a commander card that links to its deck page', () => {
    setup();

    const heading = screen.getByRole('heading', { name: /Tarkir: Dragonstorm/ });
    expect(within(heading).getByText('TDM · 2025')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Abzan Armor/ })).toHaveAttribute('href', '/decks/abzan-armor');
    expect(screen.getByRole('img', { name: 'Felothar the Steadfast' })).toHaveAttribute('src', 'https://img/abzan-armor.jpg');
    expect(screen.getByRole('img', { name: 'White, Black, Green' })).toBeInTheDocument();
    expect(screen.getByText('2 of 2 included')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Include .* in selection/ })).not.toBeInTheDocument();
  });

  it('has the Add deck button from New Simulation', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Add deck' }));
    expect(screen.getByRole('dialog', { name: 'Add a deck' })).toBeInTheDocument();
  });

  it('fades excluded decks', () => {
    setup({ excludedDeckIds: ['abzan-armor'] });

    expect(screen.getByRole('link', { name: /^Abzan Armor/ }).closest('li')).toHaveClass('opacity-50');
    expect(screen.getByRole('link', { name: /^Jeskai Striker/ }).closest('li')).not.toHaveClass('opacity-50');
    expect(screen.getByText('1 of 2 included')).toBeInTheDocument();
  });

  it('lets admins exclude one deck or a whole set', () => {
    setup({ isAdmin: true, excludedDeckIds: ['abzan-armor'] });

    const abzan = screen.getByRole('button', { name: 'Include Abzan Armor in selection' });
    expect(abzan).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(abzan);
    expect(mutate).toHaveBeenCalledWith({ deckIds: ['abzan-armor'], excluded: false });
  });

  it('excludes every included deck in a set with one save', () => {
    setup({ isAdmin: true, excludedDeckIds: ['abzan-armor'] });

    fireEvent.click(screen.getByRole('button', { name: 'Exclude all' }));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith({ deckIds: ['jeskai-striker'], excluded: true });
  });

  it('includes a whole set with one save', () => {
    setup({ isAdmin: true, excludedDeckIds: ['abzan-armor', 'jeskai-striker'] });

    fireEvent.click(screen.getByRole('button', { name: 'Include all' }));
    expect(mutate).toHaveBeenCalledWith({ deckIds: ['abzan-armor', 'jeskai-striker'], excluded: false });
  });
});
