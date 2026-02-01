import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { getApiBase } from '../api';

interface Precon {
  id: string;
  name: string;
  primaryCommander: string;
}

interface SavedDeck {
  id: string;
  name: string;
  filename: string;
}

type JobStatus = 'QUEUED' | 'RUNNING' | 'ANALYZING' | 'COMPLETED' | 'FAILED';

interface JobSummary {
  id: string;
  deckName: string;
  status: JobStatus;
  simulations: number;
  gamesCompleted: number;
  createdAt: string;
  opponents: string[];
  hasResult: boolean;
}

export default function Home() {
  const navigate = useNavigate();
  const [deckUrl, setDeckUrl] = useState('');
  const [deckText, setDeckText] = useState('');
  const [inputMode, setInputMode] = useState<'url' | 'text' | 'saved'>('url');
  const [opponentMode, setOpponentMode] = useState<'random' | 'specific'>('random');
  const [selectedOpponents, setSelectedOpponents] = useState<string[]>([]);
  const [simulations, setSimulations] = useState(5);
  const [parallelism, setParallelism] = useState(4);
  const [precons, setPrecons] = useState<Precon[]>([]);
  const [savedDecks, setSavedDecks] = useState<SavedDeck[]>([]);
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);

  // Past runs state
  const [pastRuns, setPastRuns] = useState<JobSummary[]>([]);
  const [pastRunsLoading, setPastRunsLoading] = useState(true);
  const [pastRunsError, setPastRunsError] = useState<string | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const apiBase = getApiBase();

  // Fetch precons on load
  useEffect(() => {
    fetch(`${apiBase}/api/precons`)
      .then((res) => res.json())
      .then((data) => setPrecons(data.precons || []))
      .catch((err) => console.error('Failed to load precons:', err));
  }, [apiBase]);

  // Fetch saved decks
  const fetchSavedDecks = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/decks`);
      const data = await res.json();
      setSavedDecks(data.decks || []);
    } catch (err) {
      console.error('Failed to load saved decks:', err);
    }
  }, [apiBase]);

  useEffect(() => {
    fetchSavedDecks();
  }, [fetchSavedDecks]);

  // Fetch past runs and poll when jobs are in progress
  const fetchPastRuns = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/jobs`);
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

  const handleOpponentToggle = (id: string) => {
    setSelectedOpponents((prev) => {
      if (prev.includes(id)) {
        return prev.filter((x) => x !== id);
      }
      if (prev.length >= 3) {
        return [...prev.slice(1), id];
      }
      return [...prev, id];
    });
  };

  const handleSaveDeck = async () => {
    setError(null);
    setSaveMessage(null);
    setIsSaving(true);

    try {
      const body: Record<string, string> = {};

      if (inputMode === 'url') {
        if (!deckUrl.trim()) {
          throw new Error('Please enter a deck URL');
        }
        body.deckUrl = deckUrl.trim();
      } else if (inputMode === 'text') {
        if (!deckText.trim()) {
          throw new Error('Please enter a deck list');
        }
        body.deckText = deckText.trim();
      } else {
        throw new Error('Cannot save from saved deck mode');
      }

      const response = await fetch(`${apiBase}/api/decks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to save deck');
      }

      setSaveMessage(`Deck saved as "${data.name}"`);
      await fetchSavedDecks();
      
      // Clear the input after saving
      if (inputMode === 'url') {
        setDeckUrl('');
      } else {
        setDeckText('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save deck');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteDeck = async (deck: SavedDeck) => {
    if (!confirm(`Delete "${deck.name}"?`)) {
      return;
    }

    setIsDeleting(deck.id);
    setError(null);

    try {
      const response = await fetch(`${apiBase}/api/decks/${encodeURIComponent(deck.filename)}`, {
        method: 'DELETE',
      });

      if (!response.ok && response.status !== 204) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete deck');
      }

      // Clear selection if we deleted the selected deck
      if (selectedDeckId === deck.id) {
        setSelectedDeckId(null);
      }

      await fetchSavedDecks();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete deck');
    } finally {
      setIsDeleting(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaveMessage(null);
    const key = idempotencyKey ?? crypto.randomUUID();
    if (!idempotencyKey) setIdempotencyKey(key);
    setIsSubmitting(true);

    try {
      const body: Record<string, unknown> = {
        opponentMode,
        simulations,
        parallelism,
        idempotencyKey: key,
      };

      if (inputMode === 'url') {
        if (!deckUrl.trim()) {
          throw new Error('Please enter a deck URL');
        }
        body.deckUrl = deckUrl.trim();
      } else if (inputMode === 'text') {
        if (!deckText.trim()) {
          throw new Error('Please enter a deck list');
        }
        body.deckText = deckText.trim();
      } else if (inputMode === 'saved') {
        if (!selectedDeckId) {
          throw new Error('Please select a saved deck');
        }
        body.deckId = selectedDeckId;
      }

      if (opponentMode === 'specific') {
        if (selectedOpponents.length !== 3) {
          throw new Error('Please select exactly 3 opponents');
        }
        body.opponentIds = selectedOpponents;
      }

      const response = await fetch(`${apiBase}/api/jobs`, {
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
      setError(err instanceof Error ? err.message : 'An error occurred');
      setIdempotencyKey(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-4xl font-bold text-center mb-4">
        Magic Bracket Simulator
      </h1>
      <p className="text-gray-400 text-center mb-8">
        Submit your Commander deck to analyze its power bracket by simulating
        games against preconstructed decks.
      </p>

      <form
        onSubmit={handleSubmit}
        className="bg-gray-800 rounded-lg p-6 space-y-6"
      >
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Deck Input Method
          </label>
          <div className="flex gap-4 flex-wrap">
            <button
              type="button"
              onClick={() => setInputMode('url')}
              className={`px-4 py-2 rounded-md ${
                inputMode === 'url'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              Deck URL
            </button>
            <button
              type="button"
              onClick={() => setInputMode('text')}
              className={`px-4 py-2 rounded-md ${
                inputMode === 'text'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              Deck List
            </button>
            <button
              type="button"
              onClick={() => setInputMode('saved')}
              className={`px-4 py-2 rounded-md ${
                inputMode === 'saved'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              Saved Deck
            </button>
          </div>
        </div>

        {inputMode === 'url' && (
          <div>
            <label
              htmlFor="deckUrl"
              className="block text-sm font-medium text-gray-300 mb-2"
            >
              Moxfield or Archidekt URL
            </label>
            <input
              id="deckUrl"
              type="url"
              value={deckUrl}
              onChange={(e) => setDeckUrl(e.target.value)}
              placeholder="https://moxfield.com/decks/..."
              className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="button"
              onClick={handleSaveDeck}
              disabled={isSaving || !deckUrl.trim()}
              className={`mt-2 px-4 py-2 rounded-md text-sm ${
                isSaving || !deckUrl.trim()
                  ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                  : 'bg-green-600 text-white hover:bg-green-700'
              }`}
            >
              {isSaving ? 'Saving...' : 'Save Deck for Later'}
            </button>
          </div>
        )}

        {inputMode === 'text' && (
          <div>
            <label
              htmlFor="deckText"
              className="block text-sm font-medium text-gray-300 mb-2"
            >
              Deck List
            </label>
            <textarea
              id="deckText"
              value={deckText}
              onChange={(e) => setDeckText(e.target.value)}
              placeholder={`[Commander]\n1 Ashling the Pilgrim\n\n[Main]\n1 Sol Ring\n99 Mountain`}
              rows={10}
              className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
            />
            <button
              type="button"
              onClick={handleSaveDeck}
              disabled={isSaving || !deckText.trim()}
              className={`mt-2 px-4 py-2 rounded-md text-sm ${
                isSaving || !deckText.trim()
                  ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                  : 'bg-green-600 text-white hover:bg-green-700'
              }`}
            >
              {isSaving ? 'Saving...' : 'Save Deck for Later'}
            </button>
          </div>
        )}

        {inputMode === 'saved' && (
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Select a Saved Deck
            </label>
            {savedDecks.length === 0 ? (
              <div className="bg-gray-700 rounded-md p-4 text-gray-400 text-sm">
                No saved decks. Use the URL or Deck List tab and click "Save Deck for Later" to add one.
              </div>
            ) : (
              <div className="max-h-64 overflow-y-auto bg-gray-700 rounded-md p-3 space-y-2">
                {savedDecks.map((deck) => (
                  <div
                    key={deck.id}
                    className={`flex items-center justify-between p-2 rounded cursor-pointer ${
                      selectedDeckId === deck.id
                        ? 'bg-blue-600/30 border border-blue-500'
                        : 'bg-gray-600 hover:bg-gray-500'
                    }`}
                    onClick={() => setSelectedDeckId(deck.id)}
                  >
                    <span className="text-sm flex-1">{deck.name}</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteDeck(deck);
                      }}
                      disabled={isDeleting === deck.id}
                      className={`ml-2 px-2 py-1 rounded text-xs ${
                        isDeleting === deck.id
                          ? 'bg-gray-500 text-gray-300 cursor-not-allowed'
                          : 'bg-red-600 text-white hover:bg-red-700'
                      }`}
                    >
                      {isDeleting === deck.id ? '...' : 'Delete'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Opponents
          </label>
          <div className="flex gap-4 mb-4">
            <button
              type="button"
              onClick={() => setOpponentMode('random')}
              className={`px-4 py-2 rounded-md ${
                opponentMode === 'random'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              Random Precons
            </button>
            <button
              type="button"
              onClick={() => setOpponentMode('specific')}
              className={`px-4 py-2 rounded-md ${
                opponentMode === 'specific'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              Select Precons
            </button>
          </div>

          {opponentMode === 'specific' && (
            <div className="max-h-64 overflow-y-auto bg-gray-700 rounded-md p-3">
              <p className="text-sm text-gray-400 mb-2">
                Select exactly 3 precons ({selectedOpponents.length}/3 selected)
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {precons.map((precon) => (
                  <label
                    key={precon.id}
                    className={`flex items-center gap-2 p-2 rounded cursor-pointer ${
                      selectedOpponents.includes(precon.id)
                        ? 'bg-blue-600/30 border border-blue-500'
                        : 'bg-gray-600 hover:bg-gray-500'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedOpponents.includes(precon.id)}
                      onChange={() => handleOpponentToggle(precon.id)}
                      className="sr-only"
                    />
                    <span className="text-sm">{precon.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        <div>
          <label
            htmlFor="simulations"
            className="block text-sm font-medium text-gray-300 mb-2"
          >
            Number of Simulations: {simulations}
          </label>
          <input
            id="simulations"
            type="range"
            min="1"
            max="100"
            value={simulations}
            onChange={(e) => setSimulations(parseInt(e.target.value))}
            className="w-full accent-blue-500"
          />
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>1</span>
            <span>25</span>
            <span>50</span>
            <span>75</span>
            <span>100</span>
          </div>
        </div>

        <div>
          <label
            htmlFor="parallelism"
            className="block text-sm font-medium text-gray-300 mb-2"
          >
            Parallel Docker Runs: {parallelism}
          </label>
          <input
            id="parallelism"
            type="range"
            min="1"
            max="8"
            value={parallelism}
            onChange={(e) => setParallelism(parseInt(e.target.value))}
            className="w-full accent-blue-500"
          />
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>1</span>
            <span>4</span>
            <span>8</span>
          </div>
        </div>

        {saveMessage && (
          <div className="bg-green-900/50 border border-green-500 text-green-200 px-4 py-3 rounded-md">
            {saveMessage}
          </div>
        )}

        {error && (
          <div className="bg-red-900/50 border border-red-500 text-red-200 px-4 py-3 rounded-md">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className={`w-full py-3 rounded-md font-semibold ${
            isSubmitting
              ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
              : 'bg-blue-600 text-white hover:bg-blue-700'
          }`}
        >
          {isSubmitting ? 'Submitting...' : 'Run Simulations'}
        </button>
      </form>

      {/* Past Runs Section */}
      <div className="mt-8">
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
            No past runs yet. Submit a deck above to start your first simulation.
          </div>
        )}

        {!pastRunsLoading && !pastRunsError && pastRuns.length > 0 && (
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {pastRuns.map((run) => (
              <Link
                key={run.id}
                to={`/jobs/${run.id}`}
                className="block bg-gray-800 rounded-lg p-4 hover:bg-gray-750 transition-colors border border-gray-700 hover:border-gray-600"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-white truncate">
                        {run.deckName}
                      </h3>
                      <StatusBadge status={run.status} />
                    </div>
                    <p className="text-sm text-gray-400 truncate">
                      vs {run.opponents.join(', ')}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-sm font-medium text-gray-300">
                      {run.gamesCompleted} / {run.simulations} games
                    </div>
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
