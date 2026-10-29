import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';

const PREVIEW_WIDTH = 250;
// Card images are 488×680; keep the same aspect ratio.
const PREVIEW_HEIGHT = Math.round((PREVIEW_WIDTH * 680) / 488);
const PREVIEW_GAP = 8;
const PREVIEW_MARGIN = 8;

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
function previewPosition(rect: DOMRect): { top: number; left: number } {
  const fitsRight = rect.right + PREVIEW_GAP + PREVIEW_WIDTH + PREVIEW_MARGIN <= window.innerWidth;
  const fitsLeft = rect.left - PREVIEW_GAP - PREVIEW_WIDTH >= PREVIEW_MARGIN;
  const left = fitsRight
    ? rect.right + PREVIEW_GAP
    : fitsLeft
      ? rect.left - PREVIEW_GAP - PREVIEW_WIDTH
      : Math.max(PREVIEW_MARGIN, (window.innerWidth - PREVIEW_WIDTH) / 2);
  const maxTop = window.innerHeight - PREVIEW_HEIGHT - PREVIEW_MARGIN;
  const top = Math.max(PREVIEW_MARGIN, Math.min(rect.top - PREVIEW_HEIGHT / 3, maxTop));
  return { top, left };
}

/**
 * Hover/focus card image previews. Spread `previewHandlers(name, imageUrl)`
 * onto a focusable element and render `previewElement` once.
 */
export function useCardPreview() {
  const [preview, setPreview] = useState<Preview | null>(null);

  const previewHandlers = useCallback((name: string, imageUrl: string | null | undefined) => {
    const show = (e: { currentTarget: HTMLElement }) => {
      if (!imageUrl) return;
      setPreview({ imageUrl, name, ...previewPosition(e.currentTarget.getBoundingClientRect()) });
    };
    const hide = () => setPreview(null);
    return { onMouseEnter: show, onFocus: show, onMouseLeave: hide, onBlur: hide };
  }, []);

  const previewElement = preview
    ? createPortal(
        <img
          src={preview.imageUrl}
          alt={preview.name}
          width={PREVIEW_WIDTH}
          height={PREVIEW_HEIGHT}
          className="pointer-events-none rounded-xl shadow-2xl"
          style={{ position: 'fixed', top: preview.top, left: preview.left, zIndex: 50 }}
        />,
        document.body,
      )
    : null;

  return { previewHandlers, previewElement };
}
