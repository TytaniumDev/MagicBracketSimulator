import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { RunControl } from './RunControl';

describe('RunControl', () => {
  it('submits from the main button and keeps games behind the gear', () => {
    const onGamesChange = vi.fn();
    render(<RunControl label="Run simulation" disabled={false} games={100} onGamesChange={onGamesChange} podCount={1} />);

    expect(screen.getByRole('button', { name: 'Run simulation' })).toHaveAttribute('type', 'submit');
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Simulation settings' }));
    fireEvent.change(screen.getByRole('slider', { name: 'Games per pod' }), { target: { value: '40' } });
    expect(onGamesChange).toHaveBeenCalledWith(40);
  });

  it('shows the total games for a pod run', () => {
    render(<RunControl label="Queue 5 pods" disabled={false} games={20} onGamesChange={() => {}} podCount={5} />);
    fireEvent.click(screen.getByRole('button', { name: 'Simulation settings' }));
    expect(screen.getByText('5 pods × 20 games = 100 games')).toBeInTheDocument();
  });
});
