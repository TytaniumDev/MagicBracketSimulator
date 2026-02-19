import { useState } from 'react';
import { Link } from 'react-router-dom';
import { getApiBase, fetchWithAuth } from '../api';
import { useAuth } from '../contexts/AuthContext';

export function RequestAccessCard() {
  const { user, hasRequestedAccess, refreshAccessRequestStatus } = useAuth();
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apiBase = getApiBase();

  // Already has a pending request
  if (hasRequestedAccess && !submitted) {
    return (
      <div className="bg-gray-800 rounded-lg p-6 border border-amber-700/50 max-w-lg mx-auto">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-amber-400 text-xl">&#9203;</span>
          <h2 className="text-xl font-semibold text-amber-200">Access Request Pending</h2>
        </div>
        <p className="text-gray-300 mb-4">
          Your access request has been submitted. You'll be notified when you're approved.
        </p>
        <p className="text-gray-400 text-sm mb-4">
          In the meantime, you can browse all past simulation results.
        </p>
        <Link
          to="/"
          className="inline-block px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-md text-sm transition-colors"
        >
          Browse Simulations
        </Link>
      </div>
    );
  }

  // Successfully submitted
  if (submitted) {
    return (
      <div className="bg-gray-800 rounded-lg p-6 border border-green-700/50 max-w-lg mx-auto">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-green-400 text-xl">&#10003;</span>
          <h2 className="text-xl font-semibold text-green-200">Access Request Sent</h2>
        </div>
        <p className="text-gray-300 mb-4">
          We'll let you know when you're approved. In the meantime, browse past simulations.
        </p>
        <Link
          to="/"
          className="inline-block px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-md text-sm transition-colors"
        >
          Browse Simulations
        </Link>
      </div>
    );
  }

  // Request form
  const handleSubmit = async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      const res = await fetchWithAuth(`${apiBase}/api/access-requests`, {
        method: 'POST',
        body: JSON.stringify({
          message: message.trim() || null,
          displayName: user?.displayName || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to submit request');
      }

      setSubmitted(true);
      refreshAccessRequestStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit request');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-gray-800 rounded-lg p-6 border border-gray-700 max-w-lg mx-auto">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-gray-400 text-xl">&#128274;</span>
        <h2 className="text-xl font-semibold text-gray-200">Request Simulation Access</h2>
      </div>
      <p className="text-gray-300 mb-4">
        You can browse all past simulation results. To submit your own bracket simulations, request access below.
      </p>
      <div className="mb-4">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Why do you want access? (optional)"
          rows={3}
          maxLength={500}
          className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
        />
      </div>
      {error && (
        <div className="mb-4 bg-red-900/50 border border-red-500 text-red-200 px-4 py-2 rounded-md text-sm">
          {error}
        </div>
      )}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={isSubmitting}
        className={`w-full py-2 rounded-md font-medium ${
          isSubmitting
            ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
            : 'bg-blue-600 text-white hover:bg-blue-700'
        }`}
      >
        {isSubmitting ? 'Submitting...' : 'Request Access'}
      </button>
    </div>
  );
}
