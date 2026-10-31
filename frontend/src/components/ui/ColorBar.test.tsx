import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ColorBar } from './ColorBar';

describe('ColorBar', () => {
  it('renders one segment per color with an accessible label', () => {
    render(<ColorBar colorIdentity={['R', 'U']} />);
    const bar = screen.getByRole('img', { name: 'Blue, Red' });
    const segments = bar.querySelectorAll('[data-color]');
    expect([...segments].map((s) => s.getAttribute('data-color'))).toEqual(['U', 'R']);
    expect(segments[0]).toHaveClass('bg-mana-u');
  });

  it('renders a colorless bar for a deck with no colors', () => {
    render(<ColorBar colorIdentity={[]} />);
    expect(screen.getByRole('img', { name: 'Colorless' })).toBeInTheDocument();
  });

  it('applies custom className', () => {
    render(<ColorBar colorIdentity={['W']} className="mt-2" />);
    expect(screen.getByRole('img', { name: 'White' })).toHaveClass('mt-2');
  });
});
