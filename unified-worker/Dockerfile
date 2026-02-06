# Unified Worker - Single container for Forge simulations + log processing
# Combines: Node.js worker + Java/Forge simulator + xvfb
# No Docker-in-Docker - uses process-based parallelism

# =============================================================================
# Stage 1: Build Node.js worker
# =============================================================================
FROM node:20-slim AS node-builder

WORKDIR /build

# Copy package files and install dependencies
COPY local-worker/package*.json ./
RUN npm ci

# Copy source and build TypeScript
COPY local-worker/tsconfig.json ./
COPY local-worker/src/ ./src/
RUN npm run build

# =============================================================================
# Stage 2: Production image with all runtimes
# =============================================================================
FROM eclipse-temurin:17-jre-jammy

# Forge version - default to latest; override with: docker build --build-arg FORGE_VERSION=2.0.09
ARG FORGE_VERSION=""

# Create non-root user with home directory
RUN groupadd -r worker && useradd -r -g worker -m -d /home/worker worker

WORKDIR /app

# Install Node.js 20
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install xvfb and X11 dependencies (for Forge)
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    libxrender1 \
    libxtst6 \
    libxi6 \
    fontconfig \
    fonts-dejavu-core \
    bzip2 \
    jq \
    && rm -rf /var/lib/apt/lists/*

# Download and extract Forge
RUN if [ -z "$FORGE_VERSION" ]; then \
        FORGE_VERSION=$(curl -sSL https://api.github.com/repos/Card-Forge/forge/releases/latest | jq -r '.tag_name' | sed 's/forge-//'); \
    fi \
    && FORGE_URL="https://github.com/Card-Forge/forge/releases/download/forge-${FORGE_VERSION}/forge-installer-${FORGE_VERSION}.tar.bz2" \
    && echo "Downloading Forge version: ${FORGE_VERSION}" \
    && curl -sSL -o /tmp/forge.tar.bz2 "${FORGE_URL}" \
    && mkdir -p /tmp/forge_extract /app/forge \
    && tar -xjf /tmp/forge.tar.bz2 -C /tmp/forge_extract \
    && cp -a /tmp/forge_extract/. /app/forge/ \
    && test -f /app/forge/forge.sh || { echo "ERROR: forge.sh not found"; exit 1; } \
    && chmod +x /app/forge/forge.sh \
    && echo "Forge ${FORGE_VERSION} extracted successfully" \
    && rm -rf /tmp/forge_extract /tmp/forge.tar.bz2

# Copy precons and run script from forge-simulation-engine
COPY forge-simulation-engine/precons/ /app/forge/res/precons/
COPY forge-simulation-engine/run_sim.sh /app/forge/
RUN sed -i 's/\r$//' /app/forge/run_sim.sh && chmod +x /app/forge/run_sim.sh

# Copy Node.js worker
COPY --from=node-builder /build/dist /app/worker/dist
COPY --from=node-builder /build/node_modules /app/worker/node_modules
COPY local-worker/package.json /app/worker/

# Create directories
RUN mkdir -p /app/jobs /home/worker/.cache/forge /home/worker/.forge/decks/commander \
    && chown -R worker:worker /app /home/worker

# Set environment
ENV NODE_ENV=production
ENV FORGE_PATH=/app/forge
ENV JOBS_DIR=/app/jobs

USER worker
WORKDIR /app/worker

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "console.log('healthy')" || exit 1

ENTRYPOINT ["node", "dist/worker.js"]
