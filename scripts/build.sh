#!/bin/bash
set -euo pipefail

# Setup Node.js
if command -v nvm &>/dev/null || [ -s "$HOME/.nvm/nvm.sh" ]; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  nvm install 20 && nvm use 20
fi

# Frontend and worker builds in parallel (background)
echo "=== Frontend build (background) ==="
(cd frontend && npm ci && npm run build) &
pid_frontend=$!

echo "=== Worker build (background) ==="
(cd worker && npm ci && npm run build) &
pid_worker=$!

# API build in foreground (longest-running, benefits from streaming output)
echo "=== API build ==="
cd api && npm ci && npm run build && cd ..

# Wait for parallel builds and propagate failures
echo "=== Waiting for frontend build ==="
wait $pid_frontend
echo "=== Frontend build complete ==="

echo "=== Waiting for worker build ==="
wait $pid_worker
echo "=== Worker build complete ==="
