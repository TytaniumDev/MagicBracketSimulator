import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Allowed origins for CORS
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:3000",
  process.env.FRONTEND_URL, // For production frontend
].filter(Boolean).join(", ");

const nextConfig: NextConfig = {
  // Required for Cloud Run deployment - produces standalone build
  output: "standalone",
  
  outputFileTracingRoot: path.join(__dirname),
  
  // instrumentation.ts is automatically detected in Next.js 15+
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: allowedOrigins || "*" },
          { key: "Access-Control-Allow-Methods", value: "GET, POST, DELETE, PATCH, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type, Authorization" },
          { key: "Access-Control-Allow-Credentials", value: "true" },
        ],
      },
    ];
  },
};

export default nextConfig;
