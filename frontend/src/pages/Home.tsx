import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getApiBase } from '../api';

interface Precon {
  id: string;
  name: string;
  primaryCommander: string;
}

export default function Home() {
  const navigate = useNavigate();
  const [deckUrl, setDeckUrl] = useState('');
  const [deckText, setDeckText] = useState('');
  const [inputMode, setInputMode] = useState<'url' | 'text'>('url');
  const [opponentMode, setOpponentMode] = useState<'random' | 'specific'>('random');
  const [selectedOpponents, setSelectedOpponents] = useState<string[]>([]);
  const [simulations, setSimulations] = useState(5);
  const [precons, setPrecons] = useState<Precon[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);

  const apiBase = getApiBase();

  useEffect(() => {
    fetch(`${apiBase}/api/precons`)
      .then((res) => res.json())
      .then((data) => setPrecons(data.precons || []))
      .catch((err) => console.error('Failed to load precons:', err));
  }, [apiBase]);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const key = idempotencyKey ?? crypto.randomUUID();
    if (!idempotencyKey) setIdempotencyKey(key);
    setIsSubmitting(true);

    try {
      const body: Record<string, unknown> = {
        opponentMode,
        simulations,
        idempotencyKey: key,
      };

      if (inputMode === 'url') {
        if (!deckUrl.trim()) {
          throw new Error('Please enter a deck URL');
        }
        body.deckUrl = deckUrl.trim();
      } else {
        if (!deckText.trim()) {
          throw new Error('Please enter a deck list');
        }
        body.deckText = deckText.trim();
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
          <div className="flex gap-4">
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
            max="10"
            value={simulations}
            onChange={(e) => setSimulations(parseInt(e.target.value))}
            className="w-full accent-blue-500"
          />
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>1</span>
            <span>5</span>
            <span>10</span>
          </div>
        </div>

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
          {isSubmitting ? 'Submitting...' : 'Analyze Deck'}
        </button>
      </form>
    </div>
  );
}
