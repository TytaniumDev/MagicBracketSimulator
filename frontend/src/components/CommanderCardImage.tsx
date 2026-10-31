import type { ScryfallCard } from '../scryfall';

interface CommanderCardImageProps {
  /** Scryfall data for the commander; undefined while loading or unknown. */
  card: ScryfallCard | undefined;
  /** Commander name, for the image's alt text and the placeholder. */
  name: string | null | undefined;
  className?: string;
}

// Magic card corners: about 3mm on a 63×88mm card.
const CARD_SHAPE = 'aspect-[488/680] rounded-[4.75%/3.4%]';

/** A commander's full printed card, or a card-shaped placeholder until it loads. */
export function CommanderCardImage({ card, name, className = '' }: CommanderCardImageProps) {
  if (card?.imageUrl) {
    return (
      <img
        src={card.imageUrl}
        alt={card.name}
        width={488}
        height={680}
        loading="lazy"
        decoding="async"
        className={`block w-full h-auto bg-surface-raised ${CARD_SHAPE}${className ? ` ${className}` : ''}`}
      />
    );
  }
  return (
    <div
      className={`grid w-full place-items-center bg-surface-raised p-3 text-center text-xs text-fg-muted ${CARD_SHAPE}${className ? ` ${className}` : ''}`}
    >
      {name ?? 'No commander'}
    </div>
  );
}
