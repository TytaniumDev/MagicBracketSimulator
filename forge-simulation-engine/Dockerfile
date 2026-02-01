# Forge Simulation Engine - Headless MTG Simulator
# Uses Card-Forge (https://github.com/Card-Forge/forge) in sim mode for Commander games
# Base: OpenJDK 17 per PRD 3.1
FROM eclipse-temurin:17-jre-jammy

# Forge version - default to latest; override with: docker build --build-arg FORGE_VERSION=2.0.09
ARG FORGE_VERSION=""

# Create non-root user with home directory for security
# Home dir needed for Forge's default cache path (~/.cache/forge/)
RUN groupadd -r forge && useradd -r -g forge -m -d /home/forge forge

WORKDIR /app

# Download and extract Forge
# If FORGE_VERSION is empty, fetch latest from GitHub API
# The tar.bz2 contains forge.sh launcher, lib/, res/ at root (no standalone forge.jar)
RUN apt-get update && apt-get install -y --no-install-recommends curl bzip2 jq \
    && if [ -z "$FORGE_VERSION" ]; then \
        FORGE_VERSION=$(curl -sSL https://api.github.com/repos/Card-Forge/forge/releases/latest | jq -r '.tag_name' | sed 's/forge-//'); \
    fi \
    && FORGE_URL="https://github.com/Card-Forge/forge/releases/download/forge-${FORGE_VERSION}/forge-installer-${FORGE_VERSION}.tar.bz2" \
    && echo "Downloading Forge version: ${FORGE_VERSION}" \
    && curl -sSL -o /tmp/forge.tar.bz2 "${FORGE_URL}" \
    && mkdir -p /tmp/forge_extract \
    && tar -xjf /tmp/forge.tar.bz2 -C /tmp/forge_extract \
    && cp -a /tmp/forge_extract/. /app/ \
    && test -f /app/forge.sh || { echo "ERROR: forge.sh not found in extracted archive"; exit 1; } \
    && chmod +x /app/forge.sh \
    && echo "Forge ${FORGE_VERSION} extracted successfully" \
    && rm -rf /tmp/forge_extract /tmp/forge.tar.bz2 \
    && apt-get purge -y curl bzip2 jq \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

# Copy precons and entrypoint
COPY precons/ /app/res/precons/
COPY run_sim.sh /app/
RUN sed -i 's/\r$//' /app/run_sim.sh && chmod +x /app/run_sim.sh

# Validate manifest decks exist (build fails if any listed file is missing)
RUN apt-get update && apt-get install -y --no-install-recommends jq \
    && cd /app/res/precons \
    && if [ -f manifest.json ]; then \
        set -e; \
        jq -r '.precons[].filename' manifest.json > /tmp/decklist || { echo "ERROR: manifest.json is invalid or unparseable"; exit 1; }; \
        while IFS= read -r deck; do \
            [ -f "$deck" ] || { echo "Missing precon: $deck"; exit 1; }; \
        done < /tmp/decklist; \
        rm -f /tmp/decklist; \
    fi \
    && apt-get purge -y jq && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

# Virtual display and X11 libraries required for Forge's GUI initialization in sim mode
# xvfb provides virtual display; libxrender1, libxtst6, libxi6 are X11 libs needed by Java AWT
# fontconfig and fonts-dejavu-core provide fonts required by Java graphics subsystem
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    libxrender1 \
    libxtst6 \
    libxi6 \
    fontconfig \
    fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

# Create directories for volumes (decks in, logs out, ephemeral run)
# Also create Forge's default directory structure in user home
# ~/.forge/decks/commander/ is where Forge looks for Commander decks when -f Commander is used
RUN mkdir -p /app/decks /app/logs /app/run /app/forge_data \
    && mkdir -p /home/forge/.cache/forge /home/forge/.forge/decks/commander \
    && chown -R forge:forge /app /home/forge

USER forge

# Orchestrator mounts: -v decks_vol:/app/decks -v logs_vol:/app/logs
VOLUME ["/app/decks", "/app/logs"]

ENTRYPOINT ["/bin/bash", "/app/run_sim.sh"]
CMD []
