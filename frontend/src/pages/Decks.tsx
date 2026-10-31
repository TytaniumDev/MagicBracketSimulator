import { useCallback, useMemo, useState } from 'react';
import type { LibraryDeck } from '../api';
import { DeckGrid } from '../components/DeckGrid';
import { Spinner } from '../components/Spinner';
import { IconButton } from '../components/ui/IconButton';
import { ExternalLinkIcon, EyeIcon, EyeOffIcon } from '../components/ui/icons';
import { useAuth } from '../contexts/AuthContext';
import { useCommanderCards } from '../hooks/useCommanderCards';
import { useDeckLibrary, useSetDecksExcluded } from '../hooks/useDeckLibrary';
import { orderDecks, type DeckSection } from '../utils/deck-order';
import type { DeckTileTarget } from '../utils/deck-tile';

const deckPageTarget = (deck: LibraryDeck): DeckTileTarget => ({
  kind: 'link',
  to: `/decks/${encodeURIComponent(deck.id)}`,
});

/**
 * Decks page: every deck in the library, grouped by set, as the same
 * commander cards New Simulation shows. Clicking a deck opens its page.
 * Admins can exclude decks from the simulation picker and auto-coverage.
 */
export default function Decks() {
  const { isAdmin } = useAuth();
  const library = useDeckLibrary();
  const setExcluded = useSetDecksExcluded();
  const [searchQuery, setSearchQuery] = useState('');

  const decks = useMemo(() => library.data?.decks ?? [], [library.data]);
  const excluded = useMemo(() => new Set(library.data?.excludedDeckIds ?? []), [library.data]);
  const commanderOf = useCommanderCards(decks);
  const isExcluded = useCallback((deck: LibraryDeck) => excluded.has(deck.id), [excluded]);

  const sections = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const matching = q
      ? decks.filter((d) =>
          [d.name, d.setName, d.primaryCommander, d.ownerEmail].some((v) => v?.toLowerCase().includes(q)),
        )
      : decks;
    return orderDecks(matching, 'set');
  }, [decks, searchQuery]);

  // Only decks whose state changes are sent, all in one save.
  const toggle = (targets: LibraryDeck[], exclude: boolean) => {
    const deckIds = targets.filter((d) => excluded.has(d.id) !== exclude).map((d) => d.id);
    if (deckIds.length > 0) setExcluded.mutate({ deckIds, excluded: exclude });
  };

  const renderActions = (deck: LibraryDeck) => (
    <>
      {deck.link && (
        <IconButton href={deck.link} label={`View ${deck.name} on ${deck.isPrecon ? 'Archidekt' : 'its source site'}`}>
          <ExternalLinkIcon />
        </IconButton>
      )}
      {isAdmin && (
        <IconButton
          label={`Include ${deck.name} in selection`}
          pressed={!excluded.has(deck.id)}
          onClick={() => toggle([deck], !excluded.has(deck.id))}
        >
          {excluded.has(deck.id) ? <EyeOffIcon /> : <EyeIcon />}
        </IconButton>
      )}
    </>
  );

  const renderSectionActions = (section: DeckSection) => {
    const includedCount = section.decks.filter((d) => !excluded.has(d.id)).length;
    const allExcluded = includedCount === 0;
    return (
      <>
        <span>
          {includedCount} of {section.decks.length} included
        </span>
        {isAdmin && (
          <button
            type="button"
            onClick={() => toggle(section.decks, !allExcluded)}
            className="text-accent hover:underline"
          >
            {allExcluded ? 'Include all' : 'Exclude all'}
          </button>
        )}
      </>
    );
  };

  const includedTotal = decks.filter((d) => !excluded.has(d.id)).length;

  return (
    <div className="max-w-7xl mx-auto flex flex-col gap-4">
      <header>
        <h1 className="text-2xl leading-9 font-bold text-fg">Decks</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Faded decks are excluded: hidden from New Simulation and skipped by auto-coverage.
          {isAdmin && ' Their results stay.'}
          {library.data && ` ${includedTotal} of ${decks.length} decks included.`}
        </p>
      </header>

      <input
        type="text"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="Search by name, set, or commander..."
        aria-label="Search decks"
        className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-muted focus:outline-none focus:ring-2 focus:ring-accent"
      />

      {setExcluded.isError && (
        <div className="bg-red-900/50 border border-red-500 text-red-200 px-4 py-2 rounded-md text-sm">
          Couldn't update the selection: {setExcluded.error.message}
        </div>
      )}
      {library.data?.communityDecksFailed && (
        <div className="bg-red-900/30 border border-red-600 text-red-200 px-4 py-2 rounded-md text-sm">
          Community decks and exclusions failed to load.{' '}
          <button type="button" onClick={() => library.refetch()} className="underline hover:text-white">
            Retry
          </button>
        </div>
      )}

      {library.isLoading ? (
        <div className="flex items-center justify-center gap-2 py-20 text-fg-muted">
          <Spinner /> Loading decks...
        </div>
      ) : (
        <DeckGrid
          sections={sections}
          commanderOf={commanderOf}
          targetOf={deckPageTarget}
          isDimmed={isExcluded}
          renderActions={renderActions}
          renderSectionActions={renderSectionActions}
        />
      )}
      {!library.isLoading && sections.length === 0 && <p className="text-sm text-fg-muted">No decks match.</p>}
    </div>
  );
}
