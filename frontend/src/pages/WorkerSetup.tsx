import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getApiBase, fetchWithAuth } from '../api';

interface SetupTokenResponse {
  token: string;
  expiresIn: string;
  apiUrl: string;
  scriptUrl: string;
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="px-3 py-1.5 text-xs font-medium rounded bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors shrink-0"
    >
      {copied ? 'Copied!' : label || 'Copy'}
    </button>
  );
}

export default function WorkerSetup() {
  const { user, isAllowed, loading } = useAuth();
  const [tokenData, setTokenData] = useState<SetupTokenResponse | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateToken = async () => {
    setGenerating(true);
    setError(null);
    try {
      const apiBase = getApiBase();
      const res = await fetchWithAuth(`${apiBase}/api/worker-setup/token`, {
        method: 'POST',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data: SetupTokenResponse = await res.json();
      setTokenData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate token');
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-400" />
      </div>
    );
  }

  if (!user || !isAllowed) {
    return (
      <div className="max-w-2xl mx-auto py-12">
        <h1 className="text-2xl font-bold mb-4">Worker Setup</h1>
        <p className="text-gray-400">
          You need to be signed in as an allowed user to set up a worker.
        </p>
      </div>
    );
  }

  const oneLiner = tokenData
    ? `bash <(curl -fsSL ${tokenData.scriptUrl}) --api=${tokenData.apiUrl}`
    : null;

  return (
    <div className="max-w-3xl mx-auto py-8">
      <h1 className="text-2xl font-bold mb-2">Worker Setup</h1>
      <p className="text-gray-400 mb-8">
        Set up a remote worker on any Mac, Linux, or WSL machine. No dev tools required
        &mdash; the setup script installs everything automatically.
      </p>

      {!tokenData ? (
        <div className="space-y-4">
          <button
            onClick={generateToken}
            disabled={generating}
            className="px-5 py-2.5 bg-purple-600 hover:bg-purple-500 disabled:bg-purple-800 disabled:text-gray-400 text-white font-medium rounded-lg transition-colors"
          >
            {generating ? 'Generating...' : 'Generate Setup Token'}
          </button>
          {error && (
            <p className="text-red-400 text-sm">{error}</p>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {/* Step 1: Command */}
          <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-gray-100">
                1. Run this command
              </h2>
              <CopyButton text={oneLiner!} label="Copy command" />
            </div>
            <pre className="bg-gray-900 rounded-md p-4 text-sm text-green-400 font-mono overflow-x-auto whitespace-pre-wrap break-all">
              {oneLiner}
            </pre>
            <p className="text-xs text-gray-500 mt-2">
              Paste this into a terminal on the machine where you want to run the worker.
            </p>
          </div>

          {/* Step 2: Token */}
          <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-gray-100">
                2. When prompted, paste this token
              </h2>
              <CopyButton text={tokenData.token} label="Copy token" />
            </div>
            <pre className="bg-gray-900 rounded-md p-4 text-sm text-yellow-400 font-mono overflow-x-auto whitespace-pre-wrap break-all">
              {tokenData.token}
            </pre>
            <p className="text-xs text-gray-500 mt-2">
              Expires in {tokenData.expiresIn}. The token is entered interactively so it
              doesn't appear in your shell history.
            </p>
          </div>

          {/* What this does */}
          <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-5">
            <h2 className="text-lg font-semibold text-gray-100 mb-3">
              What this does
            </h2>
            <ul className="space-y-2 text-sm text-gray-300">
              <li className="flex gap-2">
                <span className="text-gray-500 shrink-0">1.</span>
                Installs Docker and dependencies if missing
              </li>
              <li className="flex gap-2">
                <span className="text-gray-500 shrink-0">2.</span>
                Downloads compose files from GitHub
              </li>
              <li className="flex gap-2">
                <span className="text-gray-500 shrink-0">3.</span>
                Fetches encrypted config from the API using the setup token
              </li>
              <li className="flex gap-2">
                <span className="text-gray-500 shrink-0">4.</span>
                Decrypts and writes config files locally
              </li>
              <li className="flex gap-2">
                <span className="text-gray-500 shrink-0">5.</span>
                Pulls Docker images and starts the worker
              </li>
            </ul>
          </div>

          {/* Regenerate */}
          <div className="flex items-center gap-4">
            <button
              onClick={generateToken}
              disabled={generating}
              className="px-4 py-2 text-sm bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 text-gray-200 font-medium rounded-lg transition-colors"
            >
              {generating ? 'Regenerating...' : 'Regenerate Token'}
            </button>
            {error && (
              <p className="text-red-400 text-sm">{error}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
