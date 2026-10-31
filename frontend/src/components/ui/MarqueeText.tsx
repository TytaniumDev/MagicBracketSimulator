import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';

interface MarqueeTextProps {
  text: string;
  className?: string;
}

/** Scroll speed when the text is wider than its box, in pixels per second. */
const SPEED_PX_PER_S = 30;

/**
 * One line of text that fades out at the edge when it doesn't fit, and
 * scrolls to show the rest while its `group` ancestor is hovered or focused.
 */
export function MarqueeText({ text, className = '' }: MarqueeTextProps) {
  const boxRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);

  useLayoutEffect(() => {
    const box = boxRef.current;
    const inner = textRef.current;
    if (!box || !inner) return;
    const measure = () => setOverflow(Math.max(0, Math.ceil(inner.scrollWidth - box.clientWidth)));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [text]);

  const style = overflow
    ? ({
        '--marquee-distance': `-${overflow}px`,
        '--marquee-duration': `${Math.max(2, overflow / SPEED_PX_PER_S + 1.5)}s`,
      } as CSSProperties)
    : undefined;

  return (
    <span
      ref={boxRef}
      title={overflow ? text : undefined}
      className={`block min-w-0 overflow-hidden whitespace-nowrap${overflow ? ' marquee-fade' : ''}${className ? ` ${className}` : ''}`}
    >
      <span ref={textRef} style={style} className={`inline-block${overflow ? ' marquee-scroll' : ''}`}>
        {text}
      </span>
    </span>
  );
}
