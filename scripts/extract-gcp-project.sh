#!/bin/bash
set -euo pipefail

# Trim whitespace/newlines so multiline or single-line JSON both work
SA_KEY_TRIMMED=$(echo "$SA_KEY" | tr -d '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
if ! PROJECT_ID=$(echo "$SA_KEY_TRIMMED" | jq -r '.project_id'); then
  echo "::error::Invalid GCP_SA_KEY: secret must be the full service account JSON (paste raw key as-is, one line or multiline)."
  exit 1
fi
if [ -z "$PROJECT_ID" ] || [ "$PROJECT_ID" = "null" ]; then
  echo "::error::GCP_SA_KEY has no project_id field. Use the full JSON key from GCP Console."
  exit 1
fi
echo "project_id=$PROJECT_ID" >> "$GITHUB_OUTPUT"
echo "Using GCP project: $PROJECT_ID"