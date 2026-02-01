#!/usr/bin/env bash
# Wrapper for "docker run forge-sim" that fixes volume mounts on Git Bash (Windows).
# Without this, MSYS path conversion appends ";C" to paths and creates empty folders
# named "decks;C" and "logs;C" instead of mounting ./decks and ./logs.
set -euo pipefail

if [[ -n "${MSYSTEM:-}" ]] || [[ "${OSTYPE:-}" =~ ^msys ]]; then
  export MSYS_NO_PATHCONV=1
fi

IMAGE="${FORGE_SIM_IMAGE:-forge-sim}"
exec docker run --rm \
  -v "$(pwd)/decks:/app/decks" \
  -v "$(pwd)/logs:/app/logs" \
  "$IMAGE" \
  "$@"
