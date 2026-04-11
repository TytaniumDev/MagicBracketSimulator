import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SimulationGrid } from './SimulationGrid';
import { GAMES_PER_CONTAINER } from '../types/simulation';
import type { SimulationStatus } from '../types/simulation';
import {
  mixedStateSimulations,
  allCompletedSimulations,
  allPendingSimulations,
} from '../test/fixtures';

// ---------------------------------------------------------------------------
// Game cell expansion
// ---------------------------------------------------------------------------

describe('SimulationGrid', () => {
  it('expands containers into GAMES_PER_CONTAINER game cells', () => {
    render(
      <SimulationGrid
        simulations={allCompletedSimulations}
        totalSimulations={20}
      />,
    );
    // 5 containers × 4 games = 20 cells, each with a title attribute
    const cells = screen.getAllByTitle(/sim_\d+ game \d+:/);
    expect(cells).toHaveLength(5 * GAMES_PER_CONTAINER);
  });

  it('each cell has correct title format', () => {
    render(
      <SimulationGrid
        simulations={allCompletedSimulations}
        totalSimulations={20}
      />,
    );
    expect(screen.getByTitle('sim_000 game 1: Completed')).toBeInTheDocument();
    expect(screen.getByTitle('sim_000 game 4: Completed')).toBeInTheDocument();
    expect(screen.getByTitle('sim_004 game 1: Completed')).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Legend counts
  // ---------------------------------------------------------------------------

  it('shows correct game counts in legend (containers × GAMES_PER_CONTAINER)', () => {
    render(
      <SimulationGrid
        simulations={allCompletedSimulations}
        totalSimulations={20}
      />,
    );
    // 5 completed containers × 4 = 20 completed games
    expect(screen.getByText(/Completed/)).toHaveTextContent('Completed (20)');
  });

  it('shows mixed state counts in legend', () => {
    render(
      <SimulationGrid
        simulations={mixedStateSimulations}
        totalSimulations={20}
      />,
    );
    // 2 COMPLETED × 4 = 8 completed games
    expect(screen.getByText(/^Completed/)).toHaveTextContent('Completed (8)');
    // 1 RUNNING × 4 = 4 running games
    expect(screen.getByText(/^Running/)).toHaveTextContent('Running (4)');
    // 1 FAILED × 4 = 4 failed games
    expect(screen.getByText(/^Failed/)).toHaveTextContent('Failed (4)');
    // 1 PENDING container × 4 = 4 pending games (legend item)
    const pendingLegendItems = screen.getAllByText(/^Pending/);
    const pendingWithCount = pendingLegendItems.find((el) => el.textContent?.includes('(4)'));
    expect(pendingWithCount).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Pending containers
  // ---------------------------------------------------------------------------

  it('groups containers without workerId under "Pending" label', () => {
    render(
      <SimulationGrid
        simulations={allPendingSimulations}
        totalSimulations={20}
      />,
    );
    // All 5 containers have no workerId, so all go to "Pending" group
    const pendingLabel = screen.getByText('Pending', { selector: 'span' });
    expect(pendingLabel).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Worker grouping
  // ---------------------------------------------------------------------------

  it('shows anonymized worker labels when unauthenticated', () => {
    render(
      <SimulationGrid
        simulations={mixedStateSimulations}
        totalSimulations={20}
        isAuthenticated={false}
      />,
    );
    expect(screen.getByText('Worker 1')).toBeInTheDocument();
    expect(screen.getByText('Worker 2')).toBeInTheDocument();
  });

  it('shows actual worker names when authenticated', () => {
    render(
      <SimulationGrid
        simulations={mixedStateSimulations}
        totalSimulations={20}
        isAuthenticated={true}
      />,
    );
    expect(screen.getByText('gcp-worker-alpha')).toBeInTheDocument();
    expect(screen.getByText('gcp-worker-beta')).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Failed container expansion
  // ---------------------------------------------------------------------------

  it('FAILED container produces 4 FAILED game cells', () => {
    // sim_003 is FAILED in mixedStateSimulations
    render(
      <SimulationGrid
        simulations={mixedStateSimulations}
        totalSimulations={20}
      />,
    );
    for (let g = 1; g <= GAMES_PER_CONTAINER; g++) {
      expect(screen.getByTitle(`sim_003 game ${g}: Failed`)).toBeInTheDocument();
    }
  });

  // ---------------------------------------------------------------------------
  // Empty simulations
  // ---------------------------------------------------------------------------

  it('renders placeholder PENDING cells when simulations array is empty', () => {
    render(
      <SimulationGrid
        simulations={[]}
        totalSimulations={20}
      />,
    );
    // totalSimulations=20, GAMES_PER_CONTAINER=4 → 5 expected containers → 20 pending cells
    const cells = screen.getAllByTitle(/sim_\d+ game \d+: Pending/);
    expect(cells).toHaveLength(20);
  });

  // ---------------------------------------------------------------------------
  // Tooltip on hover
  // ---------------------------------------------------------------------------

  it('shows tooltip with winner and turn on hover of completed game', () => {
    render(
      <SimulationGrid
        simulations={mixedStateSimulations}
        totalSimulations={20}
      />,
    );
    const cell = screen.getByTitle('sim_000 game 1: Completed');
    fireEvent.mouseEnter(cell);

    expect(screen.getByText(/Game 1 of sim_000/)).toBeInTheDocument();
    // Winner is 'Deck A' from the fixture
    expect(screen.getByText('Deck A')).toBeInTheDocument();
  });

  it('shows error message in tooltip for failed game', () => {
    render(
      <SimulationGrid
        simulations={mixedStateSimulations}
        totalSimulations={20}
      />,
    );
    const cell = screen.getByTitle('sim_003 game 1: Failed');
    fireEvent.mouseEnter(cell);

    expect(screen.getByText('Forge process exited with code 137')).toBeInTheDocument();
  });

  it('shows container duration in tooltip', () => {
    render(
      <SimulationGrid
        simulations={mixedStateSimulations}
        totalSimulations={20}
      />,
    );
    const cell = screen.getByTitle('sim_000 game 1: Completed');
    fireEvent.mouseEnter(cell);

    // 45_000ms = 45.0s
    expect(screen.getByText('45.0s')).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Worker override controls
  // ---------------------------------------------------------------------------

  it('does not render worker controls when workers prop is not provided', () => {
    render(
      <SimulationGrid
        simulations={mixedStateSimulations}
        totalSimulations={20}
        isAuthenticated={true}
      />,
    );
    // No WorkerOverrideControls should appear without workers prop
    expect(screen.queryByText('cap:')).not.toBeInTheDocument();
  });

  it('renders correct total game count with placeholder cells', () => {
    // Only 3 of 5 expected containers present → 2 get placeholder cells
    const partialSims = mixedStateSimulations.slice(0, 3);
    render(
      <SimulationGrid
        simulations={partialSims}
        totalSimulations={20}
      />,
    );
    // 3 real + 2 placeholder = 5 containers × 4 = 20 cells
    const cells = screen.getAllByTitle(/sim_\d+ game \d+:/);
    expect(cells).toHaveLength(20);
  });

  // ---------------------------------------------------------------------------
  // Defense-in-depth: undefined index and edge cases
  // ---------------------------------------------------------------------------

  it('renders pending placeholders when simulations have undefined index', () => {
    // Defense: handles sims delivered without index field
    const simsWithoutIndex = [
      { simId: 'sim_000', state: 'RUNNING', workerId: 'w1' } as unknown as SimulationStatus,
      { simId: 'sim_001', state: 'RUNNING', workerId: 'w1' } as unknown as SimulationStatus,
    ];
    render(
      <SimulationGrid
        simulations={simsWithoutIndex}
        totalSimulations={20}
      />,
    );
    // Sims with undefined index are skipped in simByIndex, so all 5 containers
    // become pending placeholders = 20 pending cells
    const cells = screen.getAllByTitle(/sim_\d+ game \d+: Pending/);
    expect(cells).toHaveLength(20);
  });

  it('handles totalSimulations=0 without crashing', () => {
    const { container } = render(
      <SimulationGrid
        simulations={[]}
        totalSimulations={0}
      />,
    );
    // No game cells rendered, but component doesn't crash
    const cells = container.querySelectorAll('[title]');
    expect(cells).toHaveLength(0);
  });

  it('handles totalSimulations=undefined without crashing', () => {
    const { container } = render(
      <SimulationGrid
        simulations={[]}
        totalSimulations={undefined as unknown as number}
      />,
    );
    // totalContainers guard produces 0, no cells rendered
    const cells = container.querySelectorAll('[title]');
    expect(cells).toHaveLength(0);
  });
});
