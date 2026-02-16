# ─── Simulation Image ───
# Runs exactly 1 Forge simulation (1 game), writes log file, exits.
# This image contains: Java 17 JRE + Forge + xvfb. No Node.js.
# Invoked by the worker orchestrator via `docker run`.
#
# Build context: repo root (so we can access worker/forge-engine/)
#   docker build -f simulation/Dockerfile -t simulation .

FROM eclipse-temurin:17-jre-jammy

# Forge version - pinned default; override with: docker build --build-arg FORGE_VERSION=2.0.10
ARG FORGE_VERSION="2.0.09"

# Create non-root user with home directory
RUN groupadd -r simulator && useradd -r -g simulator -m -d /home/simulator simulator

WORKDIR /app

# Install xvfb and X11 dependencies (for Forge)
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    libxrender1 \
    libxtst6 \
    libxi6 \
    fontconfig \
    fonts-dejavu-core \
    bzip2 \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Download and extract Forge
RUN FORGE_URL="https://github.com/Card-Forge/forge/releases/download/forge-${FORGE_VERSION}/forge-installer-${FORGE_VERSION}.tar.bz2" \
    && echo "Downloading Forge version: ${FORGE_VERSION}" \
    && curl -fsSL -o /tmp/forge.tar.bz2 "${FORGE_URL}" \
    && mkdir -p /tmp/forge_extract /app/forge \
    && tar -xjf /tmp/forge.tar.bz2 -C /tmp/forge_extract \
    && cp -a /tmp/forge_extract/. /app/forge/ \
    && test -f /app/forge/forge.sh || { echo "ERROR: forge.sh not found"; exit 1; } \
    && chmod +x /app/forge/forge.sh \
    && echo "Forge ${FORGE_VERSION} extracted successfully" \
    && rm -rf /tmp/forge_extract /tmp/forge.tar.bz2

# Copy precon decks and run script from shared forge-engine directory
# (build context is repo root)
COPY worker/forge-engine/precons/ /app/forge/res/precons/
COPY worker/forge-engine/run_sim.sh /app/forge/
RUN sed -i 's/\r$//' /app/forge/run_sim.sh && chmod +x /app/forge/run_sim.sh

# Create working directories
RUN mkdir -p /app/logs /home/simulator/.cache/forge /home/simulator/.forge/decks/commander \
    && chown -R simulator:simulator /app /home/simulator

# Set environment
ENV FORGE_PATH=/app/forge
ENV LOGS_DIR=/app/logs

USER simulator

# Entrypoint: run_sim.sh
# Expected usage (called by worker orchestrator):
#   docker run --rm \
#     -v <deckDir>:/home/simulator/.forge/decks/commander:ro \
#     -v <logDir>:/app/logs \
#     --memory=600m --cpus=1 \
#     simulation:latest \
#     --decks deck_0.dck deck_1.dck deck_2.dck deck_3.dck \
#     --simulations 1 \
#     --id sim_000
ENTRYPOINT ["/bin/bash", "/app/forge/run_sim.sh"]
