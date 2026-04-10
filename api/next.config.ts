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

  // Prevent webpack from bundling @google-cloud/tasks. The library loads its
  // gapic client config via `getJSON(path.join(dirname, 'cloud_tasks_client_config.json'))`
  // — a dynamic require() that webpack can't statically analyze, so the bundle
  // ends up with a broken reference like
  // '/workspace/api/.next/standalone/.next/server/chunks/cloud_tasks_client_config.json'
  // and `new CloudTasksClient()` throws MODULE_NOT_FOUND at runtime.
  //
  // Externalizing it tells Next.js to leave the package alone so Node's native
  // require() resolves the JSON sidecar from node_modules/ at runtime. The NFT
  // tracer still copies the package into the standalone output.
  //
  // The other @google-cloud/* libraries we use (firestore, pubsub,
  // secret-manager, storage) use static literal `require("./file.json")`
  // calls that webpack CAN bundle, so they don't need this.
  serverExternalPackages: ["@google-cloud/tasks"],
};

export default withSentryConfig(nextConfig, {
  // Suppress Sentry CLI warnings when no auth token is configured
  silent: true,
  // Disable source map upload when no auth token is configured
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
});
