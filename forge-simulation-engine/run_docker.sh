#!/usr/bin/env bash
# Wrapper for "docker run forge-sim" that fixes volume mounts on Git Bash (Windows).
# Without this, MSYS path conversion appends ";C" to paths and creates empty folders
# named "decks;C" and "logs;C" instead of mounting ./decks and ./logs.
set -euo pipefail

if [[ -n "${MSYSTEM:-}" ]] || [[ "${OSTYPE:-}" =~ ^msys ]]; then
  export MSYS_NO_PATHCONV=1
fi

IMAGE="${FORGE_SIM_IMAGE:-forge-sim}"

# Build the docker command arguments
CMD=(docker run --rm \
  -v "$(pwd)/decks:/app/decks" \
  -v "$(pwd)/logs:/app/logs" \
  "$IMAGE" \
  "$@")

# On macOS, use caffeinate to prevent sleep during execution
if [[ "${OSTYPE:-}" == "darwin"* ]]; then
  exec caffeinate -i "${CMD[@]}"
else
  exec "${CMD[@]}"
fi
