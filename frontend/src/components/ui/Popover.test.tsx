import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Popover } from './Popover';

function renderPopover() {
  return render(
    <div>
      <Popover button="Open" panelLabel="Settings">
        {(close) => (
          <button type="button" onClick={close}>
            Done
          </button>
        )}
      </Popover>
      <p>Outside</p>
    </div>,
  );
}

describe('Popover', () => {
  it('opens and closes from its button', () => {
    renderPopover();
    const trigger = screen.getByRole('button', { name: 'Open' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(trigger);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes on Escape, an outside click, or from its content', () => {
    renderPopover();
    const trigger = screen.getByRole('button', { name: 'Open' });

    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByText('Outside'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
