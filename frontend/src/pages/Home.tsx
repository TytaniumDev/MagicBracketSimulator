import { useState, useMemo, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getApiBase, fetchWithAuth, createJob, createPodRun, type LibraryDeck } from '../api';
import { useAuth } from '../contexts/AuthContext';
import { useDeckLibrary } from '../hooks/useDeckLibrary';
import { useCommanderCards } from '../hooks/useCommanderCards';
import { AddDeckButton } from '../components/AddDeckButton';
import { DeckPicker } from '../components/DeckPicker';
import { PodSlots } from '../components/PodSlots';
import { RunControl } from '../components/RunControl';
import { IconButton } from '../components/ui/IconButton';
import { ExternalLinkIcon, TrashIcon } from '../components/ui/icons';
import { LoginButton } from '../components/LoginButton';
import { REQUIRED_DECK_COUNT } from '@shared/types/job';
import { MAX_POD_RUN_DECKS, podCombinations, podRunPath, savedPodRunPath } from '../utils/pods';
import { DECK_SORT_OPTIONS, orderDecks, type DeckSort } from '../utils/deck-order';
import { reportHandledError } from '../errorReporting';

type Deck = LibraryDeck;

export default function Home() {
  const { user, loading } = useAuth();

  // Show loading state while auth resolves
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="animate-spin h-8 w-8 border-4 border-purple-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  // Not signed in: prompt to sign in
  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-6">
        <h2 className="text-2xl font-bold text-gray-300">Sign in to submit simulations</h2>
        <p className="text-gray-400 text-center max-w-md">
          Sign in with your Google account to submit Commander bracket simulations.
        </p>
        <LoginButton />
      </div>
    );
  }

  // Signed in and allowed: show the simulation form
  return <SimulationForm />;
}

function SimulationForm() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [selectedDeckIds, setSelectedDeckIds] = useState<string[]>([]);
  const [simulations, setSimulations] = useState(100);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Reused across retries of the same submission so the API dedups it.
  // Tied to the selection and game count: changing either starts fresh.
  const [idempotency, setIdempotency] = useState<{ key: string; signature: string } | null>(null);
  const [podsQueued, setPodsQueued] = useState(0);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sort, setSort] = useState<DeckSort>('set');

  // Deck library, minus decks excluded from selection on the Decks page
  const library = useDeckLibrary();
  const { refetch: loadDecks } = library;
  const decksLoading = library.isLoading;
  const deckError = library.data?.communityDecksFailed ? 'Failed to load community decks. Please try again.' : null;

  const apiBase = getApiBase();

  const isPodRun = selectedDeckIds.length > REQUIRED_DECK_COUNT;
  const canSubmit = selectedDeckIds.length >= REQUIRED_DECK_COUNT;
  const pods = useMemo(() => podCombinations(selectedDeckIds), [selectedDeckIds]);

  // Every deck that can be selected
  const allDecks = useMemo(() => {
    const excluded = new Set(library.data?.excludedDeckIds ?? []);
    return (library.data?.decks ?? []).filter((d) => !excluded.has(d.id));
  }, [library.data]);
  const excludedCount = (library.data?.decks.length ?? 0) - allDecks.length;
  const commanderOf = useCommanderCards(allDecks);

  const filteredDecks = useMemo(() => {
    if (!searchQuery.trim()) return allDecks;
    const q = searchQuery.toLowerCase();
    return allDecks.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        (d.setName && d.setName.toLowerCase().includes(q)) ||
        (d.primaryCommander && d.primaryCommander.toLowerCase().includes(q)) ||
        (d.ownerEmail && d.ownerEmail.toLowerCase().includes(q))
    );
  }, [allDecks, searchQuery]);
  const sections = useMemo(() => orderDecks(filteredDecks, sort), [filteredDecks, sort]);

  const selectedDecks = useMemo(
    () => selectedDeckIds.map((id) => allDecks.find((d) => d.id === id)).filter((d): d is Deck => !!d),
    [selectedDeckIds, allDecks],
  );

  const handleDeckToggle = useCallback((id: string) => {
    setSelectedDeckIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((x) => x !== id);
      }
      if (prev.length >= MAX_POD_RUN_DECKS) {
        // Replace oldest selection
        return [...prev.slice(1), id];
      }
      return [...prev, id];
    });
  }, []);

  const handleDeckRemove = useCallback((id: string) => {
    setSelectedDeckIds((prev) => prev.filter((x) => x !== id));
  }, []);

  const handleDeckAdded = async (deckId: string) => {
    await loadDecks();
    setSelectedDeckIds((prev) => (prev.includes(deckId) || prev.length >= MAX_POD_RUN_DECKS ? prev : [...prev, deckId]));
  };

  const handleDeleteDeck = async (deck: Deck) => {
    if (!confirm(`Delete "${deck.name}"?`)) {
      return;
    }

    setIsDeleting(deck.id);
    setDeleteError(null);

    try {
      const response = await fetchWithAuth(`${apiBase}/api/decks/${encodeURIComponent(deck.id)}`, {
        method: 'DELETE',
      });

      if (!response.ok && response.status !== 204) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete deck');
      }

      setSelectedDeckIds((prev) => prev.filter((id) => id !== deck.id));
      await loadDecks();
    } catch (err) {
      reportHandledError(err, { action: 'deleteDeck' });
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete deck');
    } finally {
      setIsDeleting(null);
    }
  };

  /**
   * Save the run so it can be found again from its jobs and the front page.
   * Returns where to go next. If saving fails, the pods are still queued, so
   * fall back to the unsaved jobs-list link rather than reporting an error.
   */
  const savePodRun = async (jobIds: string[], idempotencyKey: string): Promise<string> => {
    try {
      const { id } = await createPodRun({ deckIds: selectedDeckIds, jobIds, simulations, idempotencyKey });
      return savedPodRunPath(id);
    } catch (err) {
      console.error('Failed to save pod run:', err);
      reportHandledError(err, { action: 'savePodRun' });
      return podRunPath(jobIds);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (selectedDeckIds.length < REQUIRED_DECK_COUNT) {
      setSubmitError(`Please select at least ${REQUIRED_DECK_COUNT} decks`);
      return;
    }

    const signature = `${selectedDeckIds.join(',')}|${simulations}`;
    const key = idempotency?.signature === signature ? idempotency.key : crypto.randomUUID();
    setIdempotency({ key, signature });
    setIsSubmitting(true);
    setPodsQueued(0);

    if (isPodRun) {
      // One job per pod, created in order. Each pod's idempotency key is
      // derived from the run's key, so a retry after a partial failure
      // reuses the pods already queued instead of duplicating them.
      const jobIds: string[] = [];
      try {
        for (const [i, pod] of pods.entries()) {
          const { id } = await createJob({ deckIds: pod, simulations, idempotencyKey: `${key}-pod${i}` });
          jobIds.push(id);
          setPodsQueued(jobIds.length);
        }
        navigate(await savePodRun(jobIds, key));
      } catch (err) {
        reportHandledError(err, { action: 'startPods', podsQueued: jobIds.length, podCount: pods.length });
        const message = err instanceof Error ? err.message : 'An error occurred';
        setSubmitError(
          `Queued ${jobIds.length} of ${pods.length} pods before an error: ${message}. Submit again to queue the rest.`,
        );
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    try {
      const { id } = await createJob({ deckIds: selectedDeckIds, simulations, idempotencyKey: key });
      navigate(`/jobs/${id}`);
    } catch (err) {
      reportHandledError(err, { action: 'startSimulation' });
      setSubmitError(err instanceof Error ? err.message : 'An error occurred');
      setIdempotency(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  const runLabel = isSubmitting
    ? isPodRun
      ? `Queuing pods (${podsQueued}/${pods.length})...`
      : 'Submitting...'
    : isPodRun
      ? `Queue ${pods.length} pods`
      : 'Run simulation';

  return (
    <form onSubmit={handleSubmit} className="max-w-7xl mx-auto flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl leading-9 font-bold text-fg">New simulation</h1>
        <AddDeckButton onAdded={handleDeckAdded} />
      </div>

      {/* Sticks under the app bar (h-16) so Run stays in reach while scrolling the grid. */}
      <div className="sticky top-16 z-30 -mx-4 flex items-center gap-3 bg-canvas/95 px-4 py-2 backdrop-blur-sm">
        <PodSlots decks={selectedDecks} commanderOf={commanderOf} onRemove={handleDeckRemove} />
        <RunControl
          label={runLabel}
          disabled={isSubmitting || !canSubmit}
          games={simulations}
          onGamesChange={setSimulations}
          podCount={pods.length}
        />
      </div>

      {submitError && (
        <div className="bg-red-900/50 border border-red-500 text-red-200 px-4 py-3 rounded-md">
          {submitError}
        </div>
      )}
      {deleteError && (
        <div className="bg-red-900/50 border border-red-500 text-red-200 px-4 py-2 rounded-md text-sm">
          {deleteError}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by name, set, or commander..."
          aria-label="Search decks"
          className="min-w-0 flex-1 basis-60 rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-muted focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as DeckSort)}
          aria-label="Sort decks"
          className="h-9 rounded-lg border border-line-strong bg-surface px-2 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-accent"
        >
          {DECK_SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {(searchQuery.trim() || excludedCount > 0) && (
        <p className="text-xs text-fg-muted">
          {searchQuery.trim() && `Showing ${filteredDecks.length} of ${allDecks.length}. `}
          {excludedCount > 0 && (
            <>
              {excludedCount} excluded {excludedCount === 1 ? 'deck is' : 'decks are'} hidden.{' '}
              <Link to="/decks" className="text-accent hover:underline">
                Manage decks
              </Link>
            </>
          )}
        </p>
      )}

      {decksLoading && (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin h-6 w-6 border-2 border-accent border-t-transparent rounded-full mr-3" />
          <span className="text-sm text-fg-muted">Loading decks...</span>
        </div>
      )}

      {deckError && !decksLoading && (
        <div className="bg-red-900/30 border border-red-600 rounded-md p-3">
          <p className="text-sm text-red-200">{deckError}</p>
          <button
            type="button"
            onClick={() => loadDecks()}
            className="mt-2 text-sm text-red-300 hover:text-white underline"
          >
            Retry
          </button>
        </div>
      )}

      {!decksLoading && (
        <DeckPicker
          sections={sections}
          commanderOf={commanderOf}
          selectedIds={selectedDeckIds}
          onToggle={handleDeckToggle}
          renderActions={(deck) => (
            <>
              {deck.link && (
                <IconButton href={deck.link} label={`View ${deck.name} on ${deck.isPrecon ? 'Archidekt' : 'its source site'}`}>
                  <ExternalLinkIcon />
                </IconButton>
              )}
              {!deck.isPrecon && deck.ownerId === user?.uid && (
                <IconButton
                  tone="danger"
                  label={`Delete deck ${deck.name}`}
                  onClick={() => handleDeleteDeck(deck)}
                  disabled={isDeleting === deck.id}
                >
                  <TrashIcon />
                </IconButton>
              )}
            </>
          )}
        />
      )}
    </form>
  );
}
