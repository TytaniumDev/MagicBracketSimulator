import { useState } from 'react';
import * as Sentry from "@sentry/react";
import { getApiBase } from '../api';

export default function SentryExamplePage() {
  const [apiStatus, setApiStatus] = useState<string | null>(null);

  const handleThrowClientError = () => {
    Sentry.captureException(new Error("Sentry Example Frontend Error"));
    alert("Client error sent to Sentry! Check your Sentry dashboard.");
  };

  const handleThrowServerError = async () => {
    try {
      const apiBase = getApiBase();
      const res = await fetch(`${apiBase}/api/sentry-example-api`);
      if (!res.ok) {
        setApiStatus(`Server responded with ${res.status}: ${res.statusText}`);
        alert("Server error triggered! Check your Sentry dashboard for the API error.");
      } else {
        const data = await res.json();
        setApiStatus(`Server responded: ${JSON.stringify(data)}`);
      }
    } catch (error) {
      console.error("Fetch error:", error);
      Sentry.captureException(error);
      setApiStatus(`Fetch error: ${error instanceof Error ? error.message : String(error)}`);
      alert("Error triggering server error (see console).");
    }
  };

  return (
    <div className="max-w-xl mx-auto mt-16 p-6 text-center text-gray-300">
      <h1 className="text-2xl font-bold mb-4">Sentry Example Page</h1>
      <p className="mb-6">
        Click the buttons below to trigger test errors and verify that Sentry is
        capturing them correctly.
      </p>

      <div className="space-y-4">
        <button
          type="button"
          className="block w-full rounded bg-red-600 px-4 py-2 text-white hover:bg-red-700 transition-colors cursor-pointer"
          onClick={handleThrowClientError}
        >
          Throw Client Error
        </button>

        <button
          type="button"
          className="block w-full rounded bg-orange-600 px-4 py-2 text-white hover:bg-orange-700 transition-colors cursor-pointer"
          onClick={handleThrowServerError}
        >
          Throw Server Error
        </button>
      </div>

      {apiStatus && (
        <div className="mt-6 p-4 bg-gray-800 rounded text-sm text-gray-400 font-mono">
          {apiStatus}
        </div>
      )}
    </div>
  );
}
