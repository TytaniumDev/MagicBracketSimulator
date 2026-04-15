#!/bin/bash
set -euo pipefail

if docker manifest inspect "${SIMULATION_IMAGE}:forge-${FORGE_VERSION}" > /dev/null 2>&1; then
  echo "Tag forge-${FORGE_VERSION} already exists, no rebuild needed"
  echo "rebuilt=false" >> "$GITHUB_OUTPUT"
else
  echo "Tag forge-${FORGE_VERSION} not found, rebuild needed"
  echo "rebuilt=true" >> "$GITHUB_OUTPUT"
fi