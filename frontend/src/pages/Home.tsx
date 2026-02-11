import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { getApiBase, fetchWithAuth } from '../api';
import { useAuth } from '../contexts/AuthContext';
import { ColorIdentity } from '../components/ColorIdentity';
import { SliderWithInput } from '../components/SliderWithInput';

interface Deck {
  id: string;
  name: string;
  filename: string;
  colorIdentity?: string[];
  isPrecon: boolean;
  link?: string | null;
  ownerId: string | null;
  ownerEmail?: string | null;
}

interface DeckOption {
  id: string;
  name: string;
  type: 'saved' | 'precon';
  deck: Deck;
}

type JobStatus = 'QUEUED' | 'RUNNING' | 'ANALYZING' | 'COMPLETED' | 'FAILED';

interface JobSummary {
  id: string;
  name: string;
  deckNames: string[];
  status: JobStatus;
  simulations: number;
  gamesCompleted: number;
  createdAt: string;
  hasResult: boolean;
  durationMs?: number | null;
}

function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = ((ms % 60_000) / 1000).toFixed(1);
  return `${minutes}m ${seconds}s`;
}

export default function Home() {
  const navigate = useNavigate();
  const { user } = useAuth();
  
  // Add deck state
  const [deckUrl, setDeckUrl] = useState('');
  const [deckText, setDeckText] = useState('');
  const [deckName, setDeckName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Moxfield API availability (null = loading, true = direct fetch works, false = manual paste required)
  const [moxfieldEnabled, setMoxfieldEnabled] = useState<boolean | null>(null);

  // Detect if URL is from Moxfield
  const isMoxfieldUrl = /^https?:\/\/(?:www\.)?moxfield\.com\/decks\//i.test(deckUrl.trim());
  // Only show manual paste UI if Moxfield API is NOT enabled
  const showManualPaste = isMoxfieldUrl && moxfieldEnabled === false;
  
  // Deck selection state
  const [selectedDeckIds, setSelectedDeckIds] = useState<string[]>([]);
  const [simulations, setSimulations] = useState(100);
  const [parallelism, setParallelism] = useState(10);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  
  // Data state - unified deck list
  const [decks, setDecks] = useState<Deck[]>([]);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);

  // Past runs state
  const [pastRuns, setPastRuns] = useState<JobSummary[]>([]);
  const [pastRunsLoading, setPastRunsLoading] = useState(true);
  const [pastRunsError, setPastRunsError] = useState<string | null>(null);
  const [deletingJobId, setDeletingJobId] = useState<string | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const apiBase = getApiBase();

  const precons = useMemo(() => decks.filter((d) => d.isPrecon), [decks]);
  const communityDecks = useMemo(() => decks.filter((d) => !d.isPrecon), [decks]);

  // Build combined deck options
  const deckOptions: DeckOption[] = useMemo(
    () =>
      decks.map((d) => ({
        id: d.id,
        name: d.name,
        type: d.isPrecon ? ('precon' as const) : ('saved' as const),
        deck: d,
      })),
    [decks]
  );

  // Fetch all decks (unified API)
  const fetchDecks = useCallback(async () => {
    try {
      const res = await fetchWithAuth(`${apiBase}/api/decks`);
      const data = await res.json();
      setDecks(data.decks || []);
    } catch (err) {
      console.error('Failed to load decks:', err);
    }
  }, [apiBase]);

  useEffect(() => {
    fetchDecks();
  }, [fetchDecks]);

  // Check if Moxfield direct import is available
  useEffect(() => {
    fetch(`${apiBase}/api/moxfield-status`)
      .then((res) => res.json())
      .then((data) => setMoxfieldEnabled(data.enabled))
      .catch(() => setMoxfieldEnabled(false));
  }, [apiBase]);

  // Fetch past runs and poll when jobs are in progress
  const fetchPastRuns = useCallback(async () => {
    try {
      const res = await fetchWithAuth(`${apiBase}/api/jobs`);
      if (!res.ok) {
        throw new Error('Failed to fetch past runs');
      }
      const data = await res.json();
      setPastRuns(data.jobs || []);
      setPastRunsError(null);
      return data.jobs as JobSummary[];
    } catch (err) {
      setPastRunsError(err instanceof Error ? err.message : 'Failed to load past runs');
      return [];
    } finally {
      setPastRunsLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    // Initial fetch
    fetchPastRuns().then((jobs) => {
      // Start polling if any job is in progress
      const hasInProgress = jobs.some(
        (job) => job.status === 'QUEUED' || job.status === 'RUNNING' || job.status === 'ANALYZING'
      );
      if (hasInProgress && !pollIntervalRef.current) {
        pollIntervalRef.current = setInterval(async () => {
          const updated = await fetchPastRuns();
          const stillInProgress = updated.some(
            (job) => job.status === 'QUEUED' || job.status === 'RUNNING' || job.status === 'ANALYZING'
          );
          if (!stillInProgress && pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
        }, 3000);
      }
    });

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [fetchPastRuns]);

  const handleDeckToggle = (id: string) => {
    setSelectedDeckIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((x) => x !== id);
      }
      if (prev.length >= 4) {
        // Replace oldest selection
        return [...prev.slice(1), id];
      }
      return [...prev, id];
    });
  };

  const handleSaveDeck = async () => {
    setSaveError(null);
    setSaveMessage(null);
    setIsSaving(true);

    try {
      let body: Record<string, string>;

      if (showManualPaste) {
        // Moxfield API not available - use manual paste
        if (!deckText.trim()) throw new Error('Please paste your deck list from Moxfield');
        body = { deckText: deckText.trim(), deckLink: deckUrl.trim() };
        if (deckName.trim()) {
          body.deckName = deckName.trim();
        }
      } else {
        // URL can be fetched directly (including Moxfield when API is enabled)
        if (!deckUrl.trim()) throw new Error('Please enter a deck URL');
        body = { deckUrl: deckUrl.trim() };
      }

      const response = await fetchWithAuth(`${apiBase}/api/decks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to save deck');
      }

      setSaveMessage(`Deck saved: "${data.name}"`);
      await fetchDecks();
      setDeckUrl('');
      setDeckText('');
      setDeckName('');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save deck');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteDeck = async (deck: Deck) => {
    if (!confirm(`Delete "${deck.name}"?`)) {
      return;
    }

    setIsDeleting(deck.id);

    try {
      const response = await fetchWithAuth(`${apiBase}/api/decks/${encodeURIComponent(deck.id)}`, {
        method: 'DELETE',
      });

      if (!response.ok && response.status !== 204) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete deck');
      }

      // Clear selection if we deleted a selected deck
      if (selectedDeckIds.includes(deck.id)) {
        setSelectedDeckIds((prev) => prev.filter((id) => id !== deck.id));
      }

      await fetchDecks();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to delete deck');
    } finally {
      setIsDeleting(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    
    if (selectedDeckIds.length !== 4) {
      setSubmitError('Please select exactly 4 decks');
      return;
    }

    const key = idempotencyKey ?? crypto.randomUUID();
    if (!idempotencyKey) setIdempotencyKey(key);
    setIsSubmitting(true);

    try {
      const body = {
        deckIds: selectedDeckIds,
        simulations,
        parallelism,
        idempotencyKey: key,
      };

      const response = await fetchWithAuth(`${apiBase}/api/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create job');
      }

      navigate(`/jobs/${data.id}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'An error occurred');
      setIdempotencyKey(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteJob = async (e: React.MouseEvent, jobId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('Delete this run? This cannot be undone.')) {
      return;
    }
    setDeletingJobId(jobId);
    try {
      const response = await fetchWithAuth(`${apiBase}/api/jobs/${encodeURIComponent(jobId)}`, {
        method: 'DELETE',
      });
      if (!response.ok && response.status !== 204) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete run');
      }
      await fetchPastRuns();
    } catch (err) {
      setPastRunsError(err instanceof Error ? err.message : 'Failed to delete run');
    } finally {
      setDeletingJobId(null);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-4xl font-bold text-center mb-4">
        Magic Bracket Simulator
      </h1>
      <p className="text-gray-400 text-center mb-8">
        Simulate Commander games between any 4 decks to analyze performance.
      </p>

      {/* Add Deck Section */}
      <div className="bg-gray-800 rounded-lg p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4">Add a Deck</h2>
        <p className="text-sm text-gray-400 mb-4">
          Import a deck from Moxfield, Archidekt, or ManaBox.
        </p>

        <div className="flex gap-2 mb-3">
          <input
            type="url"
            value={deckUrl}
            onChange={(e) => setDeckUrl(e.target.value)}
            placeholder="https://moxfield.com/decks/... or https://archidekt.com/decks/..."
            className="flex-1 px-4 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {!showManualPaste && (
            <button
              type="button"
              onClick={handleSaveDeck}
              disabled={isSaving || !deckUrl.trim()}
              className={`px-4 py-2 rounded-md ${
                isSaving || !deckUrl.trim()
                  ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                  : 'bg-green-600 text-white hover:bg-green-700'
              }`}
            >
              {isSaving ? 'Adding...' : 'Add Deck'}
            </button>
          )}
        </div>

        {showManualPaste && (
          <>
            <div className="bg-amber-900/30 border border-amber-600 rounded-md p-3 mb-4">
              <p className="text-sm text-amber-200 mb-2">
                <strong>Moxfield requires manual export.</strong> Follow these steps:
              </p>
              <ol className="text-sm text-amber-100/80 list-decimal list-inside space-y-1">
                <li>Open your deck on Moxfield (link above)</li>
                <li>Click the <span className="text-amber-100 font-medium">Export</span> button (top right)</li>
                <li>Select <span className="text-amber-100 font-medium">MTGO</span> format</li>
                <li>Click <span className="text-amber-100 font-medium">Copy to Clipboard</span></li>
                <li>Paste below</li>
              </ol>
            </div>

            <div className="mb-3">
              <input
                type="text"
                value={deckName}
                onChange={(e) => setDeckName(e.target.value)}
                placeholder="Deck name (optional)"
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <textarea
              value={deckText}
              onChange={(e) => setDeckText(e.target.value)}
              placeholder={`Paste your deck list here...\n\nExample:\n1 Sol Ring\n1 Command Tower\n1 Arcane Signet`}
              rows={8}
              className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm resize-y"
            />

            <button
              type="button"
              onClick={handleSaveDeck}
              disabled={isSaving || !deckText.trim()}
              className={`mt-3 w-full py-2 rounded-md font-medium ${
                isSaving || !deckText.trim()
                  ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                  : 'bg-green-600 text-white hover:bg-green-700'
              }`}
            >
              {isSaving ? 'Adding...' : 'Add Deck'}
            </button>
          </>
        )}

        {saveMessage && (
          <div className="mt-3 bg-green-900/50 border border-green-500 text-green-200 px-4 py-2 rounded-md text-sm">
            {saveMessage}
          </div>
        )}
        {saveError && (
          <div className="mt-3 bg-red-900/50 border border-red-500 text-red-200 px-4 py-2 rounded-md text-sm">
            {saveError}
          </div>
        )}
      </div>

      {/* Run Simulation Section */}
      <form onSubmit={handleSubmit} className="bg-gray-800 rounded-lg p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4">Run Simulation</h2>
        <p className="text-sm text-gray-400 mb-4">
          Select exactly 4 decks to battle against each other.
        </p>

        {/* Deck Selection */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-gray-300">
              Pick 4 Decks ({selectedDeckIds.length}/4)
            </label>
            {selectedDeckIds.length > 0 && (
              <button
                type="button"
                onClick={() => setSelectedDeckIds([])}
                className="text-xs text-gray-400 hover:text-white"
              >
                Clear selection
              </button>
            )}
          </div>
          
          <div className="max-h-80 overflow-y-auto bg-gray-700 rounded-md p-3">
            {/* Community Decks Group */}
            {communityDecks.length > 0 && (
              <div className="mb-4">
                <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
                  Community Decks
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {communityDecks.map((deck) => (
                    <div
                      key={deck.id}
                      role="checkbox"
                      aria-checked={selectedDeckIds.includes(deck.id)}
                      tabIndex={0}
                      className={`flex items-center justify-between p-2 rounded cursor-pointer select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
                        selectedDeckIds.includes(deck.id)
                          ? 'bg-blue-600/30 border border-blue-500'
                          : 'bg-gray-600 hover:bg-gray-500 border border-transparent'
                      }`}
                      onClick={() => handleDeckToggle(deck.id)}
                      onKeyDown={(e) => {
                        if (e.key === ' ' || e.key === 'Enter') {
                          e.preventDefault();
                          handleDeckToggle(deck.id);
                        }
                      }}
                    >
                      <div className="flex-1 min-w-0">
                        <span className="text-sm flex items-center">
                          <span className="truncate">{deck.name}</span>
                          <ColorIdentity colorIdentity={deck.colorIdentity} className="ml-1.5" />
                        </span>
                        <div className="text-xs text-gray-400 mt-0.5">
                          {deck.ownerEmail ?? 'unknown'}
                          {deck.link && (
                            <>
                              {' · '}
                              <a
                                href={deck.link}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="text-blue-400 hover:underline"
                              >
                                View source
                              </a>
                            </>
                          )}
                        </div>
                      </div>
                      {deck.ownerId === user?.uid && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteDeck(deck);
                          }}
                          disabled={isDeleting === deck.id}
                          aria-label={`Delete deck ${deck.name}`}
                          className={`ml-2 px-2 py-0.5 rounded text-xs ${
                            isDeleting === deck.id
                              ? 'bg-gray-500 text-gray-300 cursor-not-allowed'
                              : 'bg-red-600/50 text-red-200 hover:bg-red-600'
                          }`}
                        >
                          {isDeleting === deck.id ? '...' : 'X'}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Preconstructed Decks Group */}
            <div>
              <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
                Preconstructed Decks
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {precons.map((deck) => (
                  <div
                    key={deck.id}
                    role="checkbox"
                    aria-checked={selectedDeckIds.includes(deck.id)}
                    tabIndex={0}
                    className={`flex items-center p-2 rounded cursor-pointer select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
                      selectedDeckIds.includes(deck.id)
                        ? 'bg-blue-600/30 border border-blue-500'
                        : 'bg-gray-600 hover:bg-gray-500 border border-transparent'
                    }`}
                    onClick={() => handleDeckToggle(deck.id)}
                    onKeyDown={(e) => {
                      if (e.key === ' ' || e.key === 'Enter') {
                        e.preventDefault();
                        handleDeckToggle(deck.id);
                      }
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <span className="text-sm flex items-center">
                        <span className="truncate">{deck.name}</span>
                        <ColorIdentity colorIdentity={deck.colorIdentity} className="ml-1.5" />
                      </span>
                      <div className="text-xs text-gray-400 mt-0.5">precon</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Selected decks summary */}
          {selectedDeckIds.length > 0 && (
            <div className="mt-3 text-sm text-gray-300">
              <span className="font-medium">Selected: </span>
              {selectedDeckIds.map((id) => {
                const deck = deckOptions.find((d) => d.id === id);
                return deck?.name ?? id;
              }).join(' vs ')}
            </div>
          )}
        </div>

        <SliderWithInput
          label="Number of Simulations"
          value={simulations}
          onChange={setSimulations}
          min={1}
          max={100}
          className="mb-4"
        />

        <SliderWithInput
          label="Parallel Docker Runs"
          value={parallelism}
          onChange={setParallelism}
          min={1}
          max={16}
          className="mb-6"
        />

        {submitError && (
          <div className="mb-4 bg-red-900/50 border border-red-500 text-red-200 px-4 py-3 rounded-md">
            {submitError}
          </div>
        )}

        <button
          type="submit"
          disabled={isSubmitting || selectedDeckIds.length !== 4}
          className={`w-full py-3 rounded-md font-semibold ${
            isSubmitting || selectedDeckIds.length !== 4
              ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
              : 'bg-blue-600 text-white hover:bg-blue-700'
          }`}
        >
          {isSubmitting ? 'Submitting...' : 'Run Simulations'}
        </button>
      </form>

      {/* Past Runs Section */}
      <div className="mb-8">
        <h2 className="text-2xl font-bold mb-4">Past Runs</h2>
        
        {pastRunsLoading && (
          <div className="bg-gray-800 rounded-lg p-6 text-gray-400 text-center">
            Loading past runs...
          </div>
        )}

        {pastRunsError && (
          <div className="bg-red-900/50 border border-red-500 text-red-200 px-4 py-3 rounded-md">
            {pastRunsError}
          </div>
        )}

        {!pastRunsLoading && !pastRunsError && pastRuns.length === 0 && (
          <div className="bg-gray-800 rounded-lg p-6 text-gray-400 text-center">
            No past runs yet. Select 4 decks above to start your first simulation.
          </div>
        )}

        {!pastRunsLoading && !pastRunsError && pastRuns.length > 0 && (
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {pastRuns.map((run) => (
              <div
                key={run.id}
                className="bg-gray-800 rounded-lg p-4 border border-gray-700 hover:border-gray-600 transition-colors flex items-start gap-3"
              >
                <Link
                  to={`/jobs/${run.id}`}
                  className="flex-1 min-w-0 block"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-white truncate">
                          {run.name}
                        </h3>
                        <StatusBadge status={run.status} />
                      </div>
                      <p className="text-sm text-gray-400 truncate">
                        {run.deckNames.join(', ')}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-sm font-medium text-gray-300">
                        {run.status === 'COMPLETED'
                          ? `${run.simulations} / ${run.simulations} games`
                          : `${run.gamesCompleted ?? 0} / ${run.simulations} games`}
                      </div>
                      {run.durationMs != null && run.durationMs >= 0 && (
                        <div className="text-xs text-gray-400">
                          Run time: {formatDurationMs(run.durationMs)}
                        </div>
                      )}
                      <div className="text-xs text-gray-500">
                        {formatDate(run.createdAt)}
                      </div>
                    </div>
                  </div>
                {(run.status === 'RUNNING' || run.status === 'ANALYZING') && (
                  <div className="mt-2">
                    <div
                      className="w-full bg-gray-700 rounded-full h-1.5 overflow-hidden"
                      role="progressbar"
                      aria-valuenow={run.gamesCompleted}
                      aria-valuemin={0}
                      aria-valuemax={run.simulations}
                    >
                      <div
                        className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
                        style={{
                          width: `${Math.min(100, (run.gamesCompleted / run.simulations) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                )}
                </Link>
                <button
                  type="button"
                  onClick={(e) => handleDeleteJob(e, run.id)}
                  disabled={deletingJobId === run.id}
                  title="Delete run"
                  aria-label={`Delete run ${run.name}`}
                  className={`flex-shrink-0 p-2 rounded text-gray-400 hover:text-red-200 hover:bg-red-900/30 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50 ${
                    deletingJobId === run.id ? 'cursor-not-allowed' : ''
                  }`}
                >
                  {deletingJobId === run.id ? (
                    <span className="text-xs">…</span>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  )}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}

function StatusBadge({ status }: { status: JobStatus }) {
  const styles: Record<JobStatus, string> = {
    QUEUED: 'bg-gray-600 text-gray-200',
    RUNNING: 'bg-blue-600 text-white',
    ANALYZING: 'bg-purple-600 text-white',
    COMPLETED: 'bg-green-600 text-white',
    FAILED: 'bg-red-600 text-white',
  };

  const labels: Record<JobStatus, string> = {
    QUEUED: 'Queued',
    RUNNING: 'Running',
    ANALYZING: 'Analyzing',
    COMPLETED: 'Completed',
    FAILED: 'Failed',
  };

  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}
