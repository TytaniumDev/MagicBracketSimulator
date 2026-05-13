#!/bin/bash
set -euo pipefail

node scripts/populate-worker-secret.js \
  --defaults \
  --api-url="$SECRET_API_URL" \
  --worker-secret="$SECRET_WORKER_SECRET"
