#!/bin/bash
set -euo pipefail

if [ -z "${API_URL:-}" ] || [ -z "${WORKER_SECRET:-}" ]; then
  echo "::warning::API_URL or WORKER_SECRET not set, skipping worker notification"
  exit 0
fi

STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "${API_URL}/api/admin/pull-image" \
  -H "Content-Type: application/json" \
  -H "X-Worker-Secret: ${WORKER_SECRET}" \
  -d '{}')

echo "Worker notification response: HTTP ${STATUS}"
if [ "${STATUS}" -ge 200 ] && [ "${STATUS}" -lt 300 ]; then
  echo "Workers notified successfully"
else
  echo "::warning::Worker notification failed with HTTP ${STATUS}"
fi
