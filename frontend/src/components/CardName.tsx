import type { ReactNode } from 'react';
import type { ScryfallCard } from '../scryfall';
import type { useCardPreview } from './CardPreview';

interface CardNameProps {
  name: string;
  info: ScryfallCard | undefined;
  previewHandlers: ReturnType<typeof useCardPreview>['previewHandlers'];
  className?: string;
  children?: ReactNode;
}

/**
 * A card name that previews the card's image on hover or focus and opens its
 * Scryfall page on click. Without Scryfall data (still loading, or unknown to
 * Scryfall) it is a plain button, so the preview still works from the keyboard.
 */
export function CardName({ name, info, previewHandlers, className, children }: CardNameProps) {
  const handlers = previewHandlers(name, info?.imageUrl);
  const content = children ?? name;
  if (!info?.scryfallUrl) {
    return (
      <button type="button" className={className} {...handlers}>
        {content}
      </button>
    );
  }
  return (
    <a href={info.scryfallUrl} target="_blank" rel="noopener noreferrer" className={className} {...handlers}>
      {content}
    </a>
  );
}
