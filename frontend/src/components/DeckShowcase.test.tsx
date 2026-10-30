import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DeckShowcase } from './DeckShowcase';
import { winsByName } from '@shared/types/job';
import { DEFAULT_DECK_NAMES, makeResults, makeSeats } from '../test/fixtures';

const DECK_NAMES = DEFAULT_DECK_NAMES;

function renderShowcase(overrides: Partial<Parameters<typeof DeckShowcase>[0]> = {}) {
  const defaults: Parameters<typeof DeckShowcase>[0] = {
    seats: makeSeats(),
    winTally: null,
    winTurns: null,
    gamesPlayed: 0,
    totalSimulations: 20,
    jobStatus: 'RUNNING',
    ...overrides,
  };
  return render(<DeckShowcase {...defaults} />);
}

// ---------------------------------------------------------------------------
// Rendering deck names
// ---------------------------------------------------------------------------

describe('DeckShowcase', () => {
  it('renders all 4 deck names', () => {
    renderShowcase();
    for (const name of DECK_NAMES) {
      expect(screen.getByTitle(name)).toBeInTheDocument();
    }
  });

  // ---------------------------------------------------------------------------
  // Win counts and percentages
  // ---------------------------------------------------------------------------

  it('displays win counts when winTally is provided', () => {
    const results = makeResults();
    renderShowcase({
      winTally: winsByName(makeSeats(), results),
      gamesPlayed: results.gamesPlayed,
      jobStatus: 'COMPLETED',
    });
    // Atraxa has 8 wins
    expect(screen.getByText('8')).toBeInTheDocument();
    // Korvold has 5 wins
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('calculates win percentage correctly (e.g., 8/20 = 40%)', () => {
    const results = makeResults();
    renderShowcase({
      winTally: winsByName(makeSeats(), results),
      gamesPlayed: results.gamesPlayed,
      jobStatus: 'COMPLETED',
    });
    // 8 / 20 = 40%
    expect(screen.getByText('(40%)')).toBeInTheDocument();
    // 5 / 20 = 25%
    expect(screen.getByText('(25%)')).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Moxfield links
  // ---------------------------------------------------------------------------

  it('shows a Decklist link for each seat with a link', () => {
    renderShowcase({
      seats: makeSeats().map((seat, i) => (i === 0 ? { ...seat, link: 'https://www.moxfield.com/decks/atraxa' } : seat)),
      jobStatus: 'COMPLETED',
    });
    const links = screen.getAllByText('Decklist');
    expect(links).toHaveLength(1);
    expect(links[0].closest('a')).toHaveAttribute('href', 'https://www.moxfield.com/decks/atraxa');
  });

  // ---------------------------------------------------------------------------
  // Leader highlight on COMPLETED
  // ---------------------------------------------------------------------------

  it('highlights the leader deck when job is COMPLETED', () => {
    const results = makeResults();
    renderShowcase({
      winTally: winsByName(makeSeats(), results),
      gamesPlayed: results.gamesPlayed,
      jobStatus: 'COMPLETED',
    });
    // The leader (Atraxa, 8 wins) should have a ring class
    const atraxaCard = screen.getByTitle(DECK_NAMES[0]).closest('div[class*="rounded-xl"]');
    expect(atraxaCard?.className).toContain('ring-1');
  });

  // ---------------------------------------------------------------------------
  // Queued state
  // ---------------------------------------------------------------------------

  it('shows dashes when job is QUEUED', () => {
    renderShowcase({ jobStatus: 'QUEUED' });
    const dashes = screen.getAllByText('--');
    expect(dashes).toHaveLength(4);
  });

  // ---------------------------------------------------------------------------
  // Running state
  // ---------------------------------------------------------------------------

  it('shows "(live)" badge when job is RUNNING', () => {
    const results = makeResults();
    renderShowcase({
      winTally: winsByName(makeSeats(), results),
      gamesPlayed: results.gamesPlayed,
      jobStatus: 'RUNNING',
    });
    const badges = screen.getAllByText('(live)');
    expect(badges.length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // Sort order
  // ---------------------------------------------------------------------------

  it('sorts decks by win count descending', () => {
    const results = makeResults();
    renderShowcase({
      winTally: winsByName(makeSeats(), results),
      gamesPlayed: results.gamesPlayed,
      jobStatus: 'COMPLETED',
    });
    const headings = screen.getAllByRole('heading', { level: 3 });
    // Atraxa (8) > Korvold (5) > Yuriko (4) > Tymna (3)
    expect(headings[0]).toHaveTextContent(DECK_NAMES[0]);
    expect(headings[1]).toHaveTextContent(DECK_NAMES[1]);
    expect(headings[2]).toHaveTextContent(DECK_NAMES[2]);
    expect(headings[3]).toHaveTextContent(DECK_NAMES[3]);
  });
});
