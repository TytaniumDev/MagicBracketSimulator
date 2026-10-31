import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactElement } from 'react';
import type { LibraryDeck } from '../api';
import { DeckPicker } from './DeckPicker';

const deck = (overrides: Partial<LibraryDeck>): LibraryDeck => ({
  id: 'abzan-armor',
  name: 'Abzan Armor',
  filename: 'abzan-armor.dck',
  colorIdentity: ['W', 'B', 'G'],
  isPrecon: true,
  link: 'https://archidekt.com/decks/1',
  ownerId: null,
  setName: 'Tarkir: Dragonstorm',
  primaryCommander: 'Felothar the Steadfast',
  ...overrides,
});

const DECKS = [
  deck({}),
  deck({ id: 'ahoy-mateys', name: 'Ahoy Mateys', colorIdentity: ['U', 'B', 'R'], setName: 'The Lost Caverns of Ixalan', primaryCommander: 'Admiral Brass, Unsinkable' }),
];

/** Scryfall answers: every set, and each requested card with an image. */
function scryfallFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  if (url.endsWith('/sets')) {
    return Promise.resolve(Response.json({
      data: [
        { code: 'tdm', name: 'Tarkir: Dragonstorm', set_type: 'expansion' },
        { code: 'lci', name: 'The Lost Caverns of Ixalan', set_type: 'expansion' },
      ],
    }));
  }
  const { identifiers } = JSON.parse(String(init?.body)) as { identifiers: { name: string }[] };
  return Promise.resolve(Response.json({
    data: identifiers.map(({ name }) => ({
      name,
      image_uris: { normal: `https://cards.scryfall.io/${encodeURIComponent(name)}.jpg`, art_crop: `https://cards.scryfall.io/${encodeURIComponent(name)}-art.jpg` },
    })),
  }));
}

function stubScreenWidth(wide: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: wide,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

function renderPicker(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('DeckPicker', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(scryfallFetch));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows each deck with its set code and commander card on wide screens', async () => {
    stubScreenWidth(true);
    renderPicker(<DeckPicker groups={[{ title: 'Precons', decks: DECKS }]} selectedIds={[]} onToggle={() => {}} />);

    const abzan = screen.getByRole('checkbox', { name: 'Select deck Abzan Armor' });
    expect(abzan).toHaveAttribute('aria-checked', 'false');
    expect(abzan).toHaveAttribute('title', 'Abzan Armor · Tarkir: Dragonstorm');
    expect(await within(abzan).findByText('TDM')).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: 'Felothar the Steadfast' })).toHaveAttribute(
      'src',
      'https://cards.scryfall.io/Felothar%20the%20Steadfast.jpg',
    );
    expect(screen.getAllByRole('img', { name: 'White, Black, Green' })).toHaveLength(1);
  });

  it('marks selected decks and reports toggles', () => {
    stubScreenWidth(true);
    const onToggle = vi.fn();
    renderPicker(<DeckPicker groups={[{ title: 'Precons', decks: DECKS }]} selectedIds={['ahoy-mateys']} onToggle={onToggle} />);

    expect(screen.getByRole('checkbox', { name: 'Select deck Ahoy Mateys' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select deck Abzan Armor' }));
    expect(onToggle).toHaveBeenCalledWith('abzan-armor');
  });

  it('renders actions without selecting the deck', () => {
    stubScreenWidth(true);
    const onToggle = vi.fn();
    const onDelete = vi.fn();
    renderPicker(
      <DeckPicker
        groups={[{ title: 'Precons', decks: [DECKS[0]] }]}
        selectedIds={[]}
        onToggle={onToggle}
        renderActions={() => <button type="button" onClick={onDelete}>Delete</button>}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalled();
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('skips empty groups', () => {
    stubScreenWidth(true);
    renderPicker(
      <DeckPicker
        groups={[{ title: 'Community Decks', decks: [] }, { title: 'Precons', decks: DECKS }]}
        selectedIds={[]}
        onToggle={() => {}}
      />,
    );
    expect(screen.queryByRole('heading', { name: 'Community Decks' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Precons' })).toBeInTheDocument();
  });

  it('shows compact rows on phones, and tapping the art opens the full card', async () => {
    stubScreenWidth(false);
    renderPicker(<DeckPicker groups={[{ title: 'Precons', decks: DECKS }]} selectedIds={[]} onToggle={() => {}} />);

    fireEvent.click(await screen.findByRole('button', { name: 'View Felothar the Steadfast' }));
    const dialog = screen.getByRole('dialog', { name: 'Felothar the Steadfast' });
    expect(within(dialog).getByRole('img', { name: 'Felothar the Steadfast' })).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
