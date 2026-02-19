import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { getApiBase, fetchWithAuth } from '../api';
import { useAuth } from '../contexts/AuthContext';
import { ColorIdentity } from '../components/ColorIdentity';
import { SliderWithInput } from '../components/SliderWithInput';
import { LoginButton } from '../components/LoginButton';
import { RequestAccessCard } from '../components/RequestAccessCard';

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

export default function Home() {
  const { user, isAllowed, loading } = useAuth();

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
          You can <Link to="/" className="text-blue-400 hover:underline">browse past results</Link> without signing in.
        </p>
        <LoginButton />
      </div>
    );
  }

  // Signed in but not on allowlist: show access request card
  if (isAllowed === false) {
    return (
      <div className="max-w-4xl mx-auto py-8">
        <RequestAccessCard />
      </div>
    );
  }

  // Signed in and allowed: show the simulation form
  return <SimulationForm />;
}

function SimulationForm() {
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);

  // Data state - unified deck list
  const [decks, setDecks] = useState<Deck[]>([]);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);

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
      const tryingMoxfieldUrl = isMoxfieldUrl && !!deckUrl.trim();

      if (isMoxfieldUrl && deckUrl.trim()) {
        body = { deckUrl: deckUrl.trim() };
      } else if (isMoxfieldUrl && deckText.trim()) {
        body = { deckText: deckText.trim(), deckLink: deckUrl.trim() };
        if (deckName.trim()) {
          body.deckName = deckName.trim();
        }
      } else if (deckUrl.trim()) {
        body = { deckUrl: deckUrl.trim() };
      } else {
        throw new Error(showManualPaste ? 'Please paste your deck list from Moxfield' : 'Please enter a deck URL');
      }

      const doPost = async () => {
        const res = await fetchWithAuth(`${apiBase}/api/decks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        return { response: res, data };
      };

      let result = await doPost();

      if (tryingMoxfieldUrl && !result.response.ok) {
        result = await doPost();
        if (!result.response.ok) {
          setMoxfieldEnabled(false);
          setSaveError(
            'Couldn\'t import from Moxfield automatically. Please paste your deck list below (Export → MTGO on Moxfield).'
          );
          return;
        }
      }

      if (!result.response.ok) {
        throw new Error(result.data.error || 'Failed to save deck');
      }

      setSaveMessage(`Deck saved: "${result.data.name}"`);
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

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-4xl font-bold text-center mb-4">
        New Simulation
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
          min={4}
          max={100}
          step={4}
          className="mb-4"
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
    </div>
  );
}
