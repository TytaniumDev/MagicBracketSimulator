#!/bin/bash
set -euo pipefail

# Setup Node.js
if command -v nvm &>/dev/null || [ -s "$HOME/.nvm/nvm.sh" ]; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  nvm install 20 && nvm use 20
fi

# Frontend tests
echo "=== Frontend unit tests ==="
cd frontend && npm ci && npm run test && cd ..

# API tests
echo "=== API unit tests ==="
cd api && npm ci && npm run test:unit

echo "=== API condenser tests ==="
npm run test:condenser && cd ..
