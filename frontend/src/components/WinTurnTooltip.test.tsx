import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WinTurnTooltip } from './WinTurnTooltip';

describe('WinTurnTooltip', () => {
  it('renders the average and total wins header', () => {
    const histogram = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1];
    render(<WinTurnTooltip histogram={histogram} avgWinTurn={10.67} totalWins={3} />);
    expect(screen.getByText('10.7')).toBeInTheDocument();
    expect(screen.getByText(/3 wins/)).toBeInTheDocument();
  });

  it('renders 16 labeled bins with "16+" as the last label', () => {
    const histogram = Array<number>(16).fill(0);
    render(<WinTurnTooltip histogram={histogram} avgWinTurn={1} totalWins={0} />);
    for (let t = 1; t <= 15; t++) {
      expect(screen.getByText(String(t))).toBeInTheDocument();
    }
    expect(screen.getByText('16+')).toBeInTheDocument();
  });

  it('scales bar heights proportionally to the max bin', () => {
    const histogram = [0, 0, 0, 2, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 1];
    const { container } = render(
      <WinTurnTooltip histogram={histogram} avgWinTurn={8.2} totalWins={7} />,
    );
    const bars = container.querySelectorAll<HTMLElement>('[data-testid="win-turn-bar"]');
    expect(bars).toHaveLength(16);
    expect(bars[7]!.style.height).toBe('100%');
    expect(bars[3]!.style.height).toBe('50%');
    expect(bars[0]!.style.height).toBe('0%');
  });
});
