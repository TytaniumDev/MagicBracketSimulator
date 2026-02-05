# Dockerfile for local-worker
# Multi-stage build: compiles TypeScript, then creates lean production image

# =============================================================================
# Stage 1: Build TypeScript
# =============================================================================
FROM node:20-slim AS builder

WORKDIR /app

# Copy package files and install all dependencies (including devDependencies for build)
COPY package*.json tsconfig.json ./
RUN npm ci

# Copy source and build
COPY src/ ./src/
RUN npm run build

# =============================================================================
# Stage 2: Production image
# =============================================================================
FROM node:20-slim

# Install gcloud CLI (required for Secret Manager access)
RUN apt-get update && apt-get install -y \
    curl \
    gnupg \
    && rm -rf /var/lib/apt/lists/*

# Install gcloud CLI
RUN echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" | tee -a /etc/apt/sources.list.d/google-cloud-sdk.list \
    && curl https://packages.cloud.google.com/apt/doc/apt-key.gpg | apt-key --keyring /usr/share/keyrings/cloud.google.gpg add - \
    && apt-get update && apt-get install -y google-cloud-sdk \
    && rm -rf /var/lib/apt/lists/*

# Install Docker CLI (to run forge-sim and misc-runner containers)
# Note: This requires Docker-in-Docker or mounting the host's Docker socket
RUN apt-get update && apt-get install -y lsb-release \
    && curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/debian $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null \
    && apt-get update && apt-get install -y docker-ce-cli \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install production dependencies only
COPY package*.json ./
RUN npm ci --only=production

# Copy built artifacts from builder stage
COPY --from=builder /app/dist ./dist

# Create jobs directory
RUN mkdir -p /app/jobs

# The worker will use Application Default Credentials from the host
# Mount ~/.config/gcloud or set GOOGLE_APPLICATION_CREDENTIALS
CMD ["node", "dist/worker.js"]
