"use client";

import * as Sentry from "@sentry/nextjs";

export default function Page() {
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
          className="block w-full rounded bg-red-600 px-4 py-2 text-white hover:bg-red-700"
          onClick={async () => {
            const transaction = Sentry.startInactiveSpan({
              name: "Example Frontend Span",
              op: "test",
            });
            Sentry.captureException(new Error("Sentry Example Frontend Error"));
            transaction.end();
            alert("Client error sent to Sentry! Check your Sentry dashboard.");
          }}
        >
          Throw Client Error
        </button>

        <button
          type="button"
          className="block w-full rounded bg-orange-600 px-4 py-2 text-white hover:bg-orange-700"
          onClick={async () => {
            const res = await fetch("/api/sentry-example-api");
            if (!res.ok) {
              alert(
                "Server error triggered! Check your Sentry dashboard for the API error."
              );
            }
          }}
        >
          Throw Server Error
        </button>
      </div>
    </div>
  );
}
