import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';

const DEFAULT_PREVIEW_WIDTH = 250;
/** A preview width that makes a card's rules text readable. */
export const READABLE_PREVIEW_WIDTH = 320;
const PREVIEW_GAP = 8;
const PREVIEW_MARGIN = 8;

/** Card images are 488×680; keep the same aspect ratio. */
function previewHeight(width: number): number {
  return Math.round((width * 680) / 488);
}

interface Preview {
  imageUrl: string;
  name: string;
  top: number;
  left: number;
}

/**
 * Place the preview beside the element: right of it if there's room, else
 * left, else (narrow screens) centered.
 */
function previewPosition(rect: DOMRect, width: number): { top: number; left: number } {
  const height = previewHeight(width);
  const fitsRight = rect.right + PREVIEW_GAP + width + PREVIEW_MARGIN <= window.innerWidth;
  const fitsLeft = rect.left - PREVIEW_GAP - width >= PREVIEW_MARGIN;
  const left = fitsRight
    ? rect.right + PREVIEW_GAP
    : fitsLeft
      ? rect.left - PREVIEW_GAP - width
      : Math.max(PREVIEW_MARGIN, (window.innerWidth - width) / 2);
  const maxTop = window.innerHeight - height - PREVIEW_MARGIN;
  const top = Math.max(PREVIEW_MARGIN, Math.min(rect.top - height / 3, maxTop));
  return { top, left };
}

/**
 * Hover/focus card image previews. Spread `previewHandlers(name, imageUrl)`
 * onto a focusable element and render `previewElement` once. `width` is the
 * preview's width in pixels.
 */
export function useCardPreview(width = DEFAULT_PREVIEW_WIDTH) {
  const [preview, setPreview] = useState<Preview | null>(null);

  const previewHandlers = useCallback((name: string, imageUrl: string | null | undefined) => {
    const show = (e: { currentTarget: HTMLElement }) => {
      if (!imageUrl) return;
      setPreview({ imageUrl, name, ...previewPosition(e.currentTarget.getBoundingClientRect(), width) });
    };
    const hide = () => setPreview(null);
    return { onMouseEnter: show, onFocus: show, onMouseLeave: hide, onBlur: hide };
  }, [width]);

  const previewElement = preview
    ? createPortal(
        <img
          src={preview.imageUrl}
          alt={preview.name}
          width={width}
          height={previewHeight(width)}
          className="pointer-events-none rounded-xl shadow-2xl"
          style={{ position: 'fixed', top: preview.top, left: preview.left, zIndex: 50 }}
        />,
        document.body,
      )
    : null;

  return { previewHandlers, previewElement };
}
