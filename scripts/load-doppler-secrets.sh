#!/bin/bash
set -euo pipefail

# Takes a list of secret names as arguments
if [ $# -eq 0 ]; then
  echo "Usage: $0 SECRET_NAME1 [SECRET_NAME2 ...]"
  exit 1
fi

SECRETS_FILE=$(mktemp)
trap 'rm -f "$SECRETS_FILE"' EXIT
doppler secrets get "$@" --json > "$SECRETS_FILE"

# Mask all secret values so they don't leak in logs
jq -r '.[].computed' "$SECRETS_FILE" | while IFS= read -r line; do
  [ -n "$line" ] && echo "::add-mask::$line"
done

# Export to GITHUB_ENV with a random delimiter to prevent injection
EOF_MARKER="$(openssl rand -hex 16)"
jq -r --arg eof "$EOF_MARKER" '
  to_entries[] | "\(.key)<<\($eof)\n\(.value.computed)\n\($eof)"
' "$SECRETS_FILE" >> "$GITHUB_ENV"
