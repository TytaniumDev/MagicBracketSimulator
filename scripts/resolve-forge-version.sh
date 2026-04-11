#!/bin/bash
set -euo pipefail

FORGE_TAG=$(curl -fsSL https://api.github.com/repos/Card-Forge/forge/releases/latest | jq -r '.tag_name')
FORGE_VERSION=${FORGE_TAG#forge-}
echo "version=${FORGE_VERSION}" >> "$GITHUB_OUTPUT"
echo "Forge version: ${FORGE_VERSION}"
