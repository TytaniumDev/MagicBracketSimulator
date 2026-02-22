#!/bin/bash
set -euo pipefail

# Setup Node.js
if command -v nvm &>/dev/null || [ -s "$HOME/.nvm/nvm.sh" ]; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  nvm install 20 && nvm use 20
fi

# Frontend
echo "=== Frontend build ==="
cd frontend && npm ci && npm run build && cd ..

# API
echo "=== API build ==="
cd api && npm ci && npm run build && cd ..

# Worker
echo "=== Worker build ==="
cd worker && npm ci && npm run build && cd ..
