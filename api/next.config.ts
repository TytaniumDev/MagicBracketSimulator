import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// CORS for /api/* is handled by middleware.ts so the response can send a single
// Access-Control-Allow-Origin value per request (CORS allows only one origin, not a list).

const nextConfig: NextConfig = {
  // Required for Cloud Run deployment - produces standalone build
  output: "standalone",

  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
