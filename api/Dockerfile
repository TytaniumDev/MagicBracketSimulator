# Dockerfile for Next.js orchestrator-service on Cloud Run
# Optimized for production deployment with standalone output

# Build stage - use slim (Debian-based) for native module compatibility
FROM node:20-slim AS builder

WORKDIR /app

# Install dependencies needed for native modules
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package.json only (not package-lock.json) to ensure 
# native modules are downloaded for the correct platform
COPY package.json ./

# Install dependencies fresh for this platform
RUN npm install

# Copy source code
COPY . .

# Build the Next.js application with standalone output
RUN npm run build

# Production stage - slim for smaller image with glibc compatibility
FROM node:20-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

# Create non-root user for security
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs nextjs

# Copy standalone build output
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Copy rubric.md for Gemini analysis
COPY --from=builder /app/rubric.md ./rubric.md

# Set correct permissions
RUN chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 8080

# Start the server
CMD ["node", "server.js"]
