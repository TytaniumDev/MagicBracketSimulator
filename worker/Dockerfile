# Worker Image (Orchestrator) — Slim Node.js-only container
# Manages simulation containers via Docker socket.
# No Java, no Forge, no xvfb — those live in the simulation image.

# =============================================================================
# Stage 1: Build Node.js worker
# =============================================================================
FROM node:20-slim AS node-builder

WORKDIR /build

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci

# Copy source and build TypeScript
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# =============================================================================
# Stage 2: Production image (Node.js + Docker CLI only)
# =============================================================================
FROM node:20-slim

# Install Docker CLI (to manage simulation containers via host socket)
RUN apt-get update && apt-get install -y --no-install-recommends \
    docker.io \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user (in docker group so it can use the socket)
RUN groupadd -r worker && useradd -r -g worker -G docker -m -d /home/worker worker

WORKDIR /app

# Copy built worker
COPY --from=node-builder /build/dist /app/dist
COPY --from=node-builder /build/node_modules /app/node_modules
COPY package.json /app/

# Create directories
RUN mkdir -p /tmp/mbs-jobs \
    && chown -R worker:worker /app /tmp/mbs-jobs

# Set environment
ENV NODE_ENV=production
ENV JOBS_DIR=/tmp/mbs-jobs

# Worker API port for push-based control
EXPOSE 9090

USER worker
WORKDIR /app

# Health check via worker HTTP API
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:9090/health || exit 1

ENTRYPOINT ["node", "dist/worker.js"]
