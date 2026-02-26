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
};

export default withSentryConfig(nextConfig, {
  // Suppress Sentry CLI warnings when no auth token is configured
  silent: true,
  // Disable source map upload when no auth token is configured
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
});
