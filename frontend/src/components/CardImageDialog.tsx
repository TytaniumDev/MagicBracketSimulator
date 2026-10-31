import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { ScryfallCard } from '../scryfall';
import { CommanderCardImage } from './CommanderCardImage';

interface CardImageDialogProps {
  /** The card to show, or null when the dialog is closed. */
  card: ScryfallCard | null;
  onClose: () => void;
}

/** A full-screen view of one card, for touch screens where hover previews don't work. */
export function CardImageDialog({ card, onClose }: CardImageDialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!card) return;
    closeRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [card, onClose]);

  if (!card) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={card.name}
      className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4"
    >
      {/* Tapping outside the card closes it; the Close button covers keyboards. */}
      <button type="button" tabIndex={-1} aria-hidden="true" onClick={onClose} className="absolute inset-0 cursor-default" />
      <div className="relative grid w-[min(340px,86vw)] justify-items-center gap-3">
        <CommanderCardImage card={card} name={card.name} className="shadow-2xl" />
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="rounded-md border border-line-strong bg-surface-raised px-4 py-2 text-sm font-semibold text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Close
        </button>
      </div>
    </div>,
    document.body,
  );
}
