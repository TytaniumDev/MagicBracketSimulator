import type { ReactNode } from 'react';

type IconButtonTone = 'default' | 'danger';

interface BaseProps {
  /** Accessible name and tooltip; the button shows only its icon. */
  label: string;
  children: ReactNode;
  tone?: IconButtonTone;
  className?: string;
}

interface LinkProps extends BaseProps {
  /** Opens in a new tab. */
  href: string;
}

interface ActionProps extends BaseProps {
  onClick: () => void;
  disabled?: boolean;
  /** Makes it a toggle button: whether it is on. */
  pressed?: boolean;
}

const TONE_CLASS: Record<IconButtonTone, string> = {
  default: 'text-fg-muted hover:text-fg hover:bg-surface-raised',
  danger: 'text-fg-muted hover:text-red-300 hover:bg-red-500/15',
};

/** A small square button or external link that shows only an icon. */
export function IconButton(props: LinkProps | ActionProps) {
  const { label, children, tone = 'default', className = '' } = props;
  const classes = `inline-grid place-items-center w-7 h-7 shrink-0 rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 disabled:cursor-wait ${TONE_CLASS[tone]}${className ? ` ${className}` : ''}`;

  if ('href' in props) {
    return (
      <a href={props.href} target="_blank" rel="noopener noreferrer" aria-label={label} title={label} className={classes}>
        {children}
      </a>
    );
  }
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      aria-pressed={props.pressed}
      aria-label={label}
      title={label}
      className={classes}
    >
      {children}
    </button>
  );
}
