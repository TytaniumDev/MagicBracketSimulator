import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

interface PopoverProps {
  /** What the trigger button shows. */
  button: ReactNode;
  /** Accessible name for the trigger, when `button` has no text of its own. */
  buttonLabel?: string;
  buttonClassName?: string;
  disabled?: boolean;
  /** Accessible name for the panel. */
  panelLabel: string;
  /** Which edge of the trigger the panel lines up with. */
  align?: 'start' | 'end';
  panelClassName?: string;
  /** The panel's content; a function gets `close` for content that closes itself. */
  children: ReactNode | ((close: () => void) => ReactNode);
}

/**
 * A button that opens a small panel below it. Clicking outside or pressing
 * Escape closes it.
 */
export function Popover({
  button,
  buttonLabel,
  buttonClassName = '',
  disabled,
  panelLabel,
  align = 'end',
  panelClassName = '',
  children,
}: PopoverProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative flex">
      <button
        ref={triggerRef}
        type="button"
        aria-label={buttonLabel}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={buttonClassName}
      >
        {button}
      </button>
      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label={panelLabel}
          className={`absolute top-full z-40 mt-2 w-max max-w-[calc(100vw-2rem)] rounded-[10px] border border-line-strong bg-surface p-3 text-fg shadow-2xl ${align === 'end' ? 'right-0' : 'left-0'}${panelClassName ? ` ${panelClassName}` : ''}`}
        >
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </div>
  );
}
