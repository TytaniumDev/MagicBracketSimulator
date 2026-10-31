import { AddDeckForm } from './AddDeckForm';
import { Popover } from './ui/Popover';
import { PlusIcon } from './ui/icons';

interface AddDeckButtonProps {
  /** Called with the new deck's id once it's saved. */
  onAdded: (deckId: string) => void;
}

/** The "Add deck" button for a page header: opens `AddDeckForm` in a popover. */
export function AddDeckButton({ onAdded }: AddDeckButtonProps) {
  return (
    <Popover
      button={
        <>
          <PlusIcon />
          Add deck
        </>
      }
      buttonClassName="flex h-9 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 text-sm font-semibold text-fg hover:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      panelLabel="Add a deck"
      panelClassName="w-[26rem]"
    >
      <AddDeckForm onAdded={onAdded} />
    </Popover>
  );
}
