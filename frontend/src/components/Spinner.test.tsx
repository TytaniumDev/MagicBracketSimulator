import { Spinner } from './Spinner';
import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

describe('Spinner', () => {
  it('renders correctly', () => {
    const { container } = render(<Spinner />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveClass('animate-spin');
    expect(svg).toHaveClass('w-4'); // Default size sm
  });

  it('applies custom className', () => {
    const { container } = render(<Spinner className="text-red-500" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveClass('text-red-500');
  });

  it('applies size classes', () => {
    const { container } = render(<Spinner size="lg" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveClass('w-8');
  });
});
