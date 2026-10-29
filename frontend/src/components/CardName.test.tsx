import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { CardName } from './CardName';
import { useCardPreview } from './CardPreview';
import type { ScryfallCard } from '../scryfall';

const solRing: ScryfallCard = {
  name: 'Sol Ring',
  typeLine: 'Artifact',
  manaCost: '{1}',
  manaValue: 1,
  imageUrl: 'https://cards.scryfall.io/sol-ring.jpg',
  scryfallUrl: 'https://scryfall.com/card/c21/263/sol-ring',
};

function Harness({ info }: { info: ScryfallCard | undefined }) {
  const { previewHandlers, previewElement } = useCardPreview();
  return (
    <>
      <CardName name="Sol Ring" info={info} previewHandlers={previewHandlers} />
      {previewElement}
    </>
  );
}

describe('CardName', () => {
  it('links to the card on Scryfall and previews it on hover', () => {
    render(<Harness info={solRing} />);
    const link = screen.getByRole('link', { name: 'Sol Ring' });
    expect(link).toHaveAttribute('href', solRing.scryfallUrl);
    expect(link).toHaveAttribute('target', '_blank');

    fireEvent.mouseEnter(link);
    expect(screen.getByRole('img', { name: 'Sol Ring' })).toHaveAttribute('src', solRing.imageUrl);
    fireEvent.mouseLeave(link);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('is a plain button without Scryfall data', () => {
    render(<Harness info={undefined} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sol Ring' })).toBeInTheDocument();
  });
});
