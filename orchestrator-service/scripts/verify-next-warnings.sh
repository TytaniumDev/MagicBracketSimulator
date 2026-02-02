#!/usr/bin/env bash
# Verify Next.js lockfile and @next/swc warnings are fixed.
# Run from orchestrator-service: ./scripts/verify-next-warnings.sh
# If node_modules is root-owned, run first: sudo chown -R $(whoami):$(whoami) node_modules

set -e
cd "$(dirname "$0")/.."

echo "Running npm install (timeout 3m)..."
if ! timeout 180 npm install; then
  echo "npm install failed or timed out. If you see EACCES, fix ownership: sudo chown -R \$(whoami):\$(whoami) node_modules"
  exit 1
fi

echo "Starting Next dev for 12s to capture startup output..."
tmp=$(mktemp)
(npm run dev 2>&1 | tee "$tmp") &
pid=$!
sleep 12
kill $pid 2>/dev/null || true
wait $pid 2>/dev/null || true

if grep -q "multiple lockfiles\|inferred your workspace root" "$tmp"; then
  echo "FAIL: Lockfile/workspace root warning still present."
  rm -f "$tmp"
  exit 1
fi
if grep -q "Mismatching @next/swc version" "$tmp"; then
  echo "FAIL: @next/swc version mismatch warning still present."
  rm -f "$tmp"
  exit 1
fi

rm -f "$tmp"
echo "OK: No Next.js lockfile or @next/swc warnings detected."
