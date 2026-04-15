import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";
import { withSentryConfig } from "@sentry/nextjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// CORS for /api/* is handled by middleware.ts so the response can send a single
// Access-Control-Allow-Origin value per request (CORS allows only one origin, not a list).

const nextConfig: NextConfig = {
  // Required for Cloud Run deployment - produces standalone build
  output: "standalone",

  outputFileTracingRoot: path.join(__dirname),

  // Treat the entire @google-cloud/* suite as runtime externals rather than
  // letting webpack bundle them into the server chunks.
  //
  // Why: @google-cloud/tasks is definitively broken under webpack — it loads
  // its gapic client config via `getJSON(path.join(dirname, 'cloud_tasks_client_config.json'))`,
  // a dynamic require() that webpack can't statically analyze, so the bundle
  // ends up with a broken reference like
  // '/workspace/api/.next/standalone/.next/server/chunks/cloud_tasks_client_config.json'
  // and `new CloudTasksClient()` throws MODULE_NOT_FOUND at runtime.
  //
  // The other libraries (firestore, pubsub, secret-manager, storage) currently
  // use static literal `require("./foo_client_config.json")` which webpack
  // DOES handle correctly — but they sit on the same google-gax runtime and
  // share the same architectural pattern, so a minor-version bump that
  // switches any of them to the dynamic-require helper would silently break
  // them the same way. Externalizing them preemptively is safer than
  // discovering the regression in production.
  //
  // Next.js 15 leaves each `require("@google-cloud/...")` as a literal runtime
  // import, and the NFT tracer still copies the full packages into the
  // standalone output so Node's native resolver finds every sidecar JSON.
  serverExternalPackages: [
    "@google-cloud/firestore",
    "@google-cloud/secret-manager",
    "@google-cloud/storage",
    "@google-cloud/tasks",
  ],
};

export default withSentryConfig(nextConfig, {
  // Suppress Sentry CLI warnings when no auth token is configured
  silent: true,
  // Disable source map upload when no auth token is configured
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
});
