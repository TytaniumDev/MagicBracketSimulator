import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { LibraryDeck } from '../api';
import { ColorIdentity } from '../components/ColorIdentity';
import { Spinner } from '../components/Spinner';
import { useAuth } from '../contexts/AuthContext';
import { useDeckLibrary, useSetDeckExcluded } from '../hooks/useDeckLibrary';
import { groupDecksBySet, type DeckGroup } from '../utils/deck-groups';

interface SelectionControls {
  excluded: Set<string>;
  /** Null when the viewer can't change selection (not an admin). */
  onToggle: ((decks: LibraryDeck[], excluded: boolean) => void) | null;
  busy: boolean;
}

function DeckTile({ deck, controls }: { deck: LibraryDeck; controls: SelectionControls }) {
  const isExcluded = controls.excluded.has(deck.id);
  return (
    <li
      className={`flex flex-col gap-2 rounded-lg border p-3 transition-colors ${
        isExcluded ? 'bg-gray-800/40 border-gray-800 opacity-60' : 'bg-gray-800 border-gray-700'
      }`}
    >
      <div className="min-w-0">
        <Link
          to={`/decks/${encodeURIComponent(deck.id)}`}
          className="flex items-center text-sm font-medium text-white hover:underline"
        >
          <span className="truncate">{deck.name}</span>
          <ColorIdentity colorIdentity={deck.colorIdentity} className="ml-1.5 shrink-0" />
        </Link>
        <div className="mt-0.5 text-xs text-gray-400 truncate">
          {deck.isPrecon ? deck.primaryCommander ?? 'precon' : deck.ownerEmail ?? 'unknown'}
        </div>
      </div>
      <div className="mt-auto flex items-center justify-between gap-2">
        {controls.onToggle ? (
          <button
            type="button"
            role="switch"
            aria-checked={!isExcluded}
            aria-label={`Include ${deck.name} in selection`}
            disabled={controls.busy}
            onClick={() => controls.onToggle?.([deck], !isExcluded)}
            className={`px-2 py-0.5 rounded text-xs font-medium disabled:cursor-wait ${
              isExcluded
                ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                : 'bg-green-700/60 text-green-100 hover:bg-green-700'
            }`}
          >
            {isExcluded ? 'Excluded' : 'Included'}
          </button>
        ) : (
          isExcluded && <span className="text-xs text-gray-500">Excluded</span>
        )}
        {deck.link && (
          <a
            href={deck.link}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-400 hover:underline"
            aria-label={`View source for ${deck.name}`}
          >
            Source
          </a>
        )}
      </div>
    </li>
  );
}

function DeckGroupSection({ group, controls }: { group: DeckGroup; controls: SelectionControls }) {
  const includedCount = group.decks.filter((d) => !controls.excluded.has(d.id)).length;
  const allExcluded = includedCount === 0;
  return (
    <section>
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <h2 className="text-sm font-semibold text-gray-200">
          {group.title}
          {group.releasedAt && (
            <span className="ml-2 font-normal text-gray-500">{group.releasedAt.slice(0, 4)}</span>
          )}
        </h2>
        <div className="flex items-center gap-3 text-xs text-gray-400">
          <span>
            {includedCount} of {group.decks.length} included
          </span>
          {controls.onToggle && (
            <button
              type="button"
              disabled={controls.busy}
              onClick={() => controls.onToggle?.(group.decks, !allExcluded)}
              className="text-blue-400 hover:text-blue-300 disabled:cursor-wait"
            >
              {allExcluded ? 'Include all' : 'Exclude all'}
            </button>
          )}
        </div>
      </div>
      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
        {group.decks.map((deck) => (
          <DeckTile key={deck.id} deck={deck} controls={controls} />
        ))}
      </ul>
    </section>
  );
}

/**
 * Decks page: every deck in the library, grouped by set. Admins can exclude
 * decks from the simulation picker and auto-coverage.
 */
export default function Decks() {
  const { isAdmin } = useAuth();
  const library = useDeckLibrary();
  const setExcluded = useSetDeckExcluded();
  const [searchQuery, setSearchQuery] = useState('');
  const [busy, setBusy] = useState(false);

  const decks = useMemo(() => library.data?.decks ?? [], [library.data]);
  const excluded = useMemo(() => new Set(library.data?.excludedDeckIds ?? []), [library.data]);

  const groups = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const matching = q
      ? decks.filter((d) =>
          [d.name, d.setName, d.primaryCommander, d.ownerEmail].some((v) => v?.toLowerCase().includes(q)),
        )
      : decks;
    return groupDecksBySet(matching);
  }, [decks, searchQuery]);

  // One request per deck, in order, so the last response holds every change.
  const toggle = async (targets: LibraryDeck[], exclude: boolean) => {
    setBusy(true);
    try {
      for (const deck of targets) {
        if (excluded.has(deck.id) !== exclude) {
          await setExcluded.mutateAsync({ deckId: deck.id, excluded: exclude });
        }
      }
    } catch {
      // Reported to Sentry by the mutation cache; the error shows below.
    } finally {
      setBusy(false);
    }
  };

  const controls: SelectionControls = { excluded, onToggle: isAdmin ? toggle : null, busy };
  const includedTotal = decks.filter((d) => !excluded.has(d.id)).length;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-white">Decks</h1>
        <p className="mt-1 text-sm text-gray-400">
          {isAdmin
            ? 'Excluded decks are hidden from New Simulation and skipped by auto-coverage. Their results stay.'
            : 'Excluded decks are hidden from New Simulation and skipped by auto-coverage.'}
          {library.data && ` ${includedTotal} of ${decks.length} decks included.`}
        </p>
      </header>

      <input
        type="text"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="Search by name, set, or commander..."
        aria-label="Search decks"
        className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
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
        <div className="flex items-center justify-center gap-2 py-20 text-gray-400">
          <Spinner /> Loading decks...
        </div>
      ) : (
        groups.map((group) => <DeckGroupSection key={group.title} group={group} controls={controls} />)
      )}
      {!library.isLoading && groups.length === 0 && (
        <p className="text-sm text-gray-400">No decks match.</p>
      )}
    </div>
  );
}
