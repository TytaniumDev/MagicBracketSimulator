#!/bin/bash
set -euo pipefail

API="https://firebaseapphosting.googleapis.com/v1/projects/magic-bracket-simulator/locations/us-central1/backends/api"

get() {
  curl -sS -H "Authorization: Bearer $(gcloud auth print-access-token)" "$@"
}

# ── 1. Wait for a READY build matching this commit (up to 10 min) ──
BUILD_NAME=""
BUILD_ID=""
echo "Polling for build matching commit ${COMMIT}..."
for i in $(seq 1 60); do
  sleep 10
  BUILD_JSON=$(get "$API/builds?pageSize=100") || BUILD_JSON='{}'
  BUILD_NAME=$(echo "$BUILD_JSON" | jq -r --arg sha "$COMMIT" '
    .builds // []
    | map(select(
        (.source.codebase.hash // "") == $sha
        and .state == "READY"
      ))
    | sort_by(.createTime)
    | last
    | .name // empty
  ')
  if [ -n "$BUILD_NAME" ]; then
    BUILD_ID=$(basename "$BUILD_NAME")
    echo "Build ready: $BUILD_ID"
    break
  fi
  echo "  [$i/60] No READY build yet for $COMMIT"
done

if [ -z "$BUILD_NAME" ]; then
  echo "::warning::No READY Firebase App Hosting build for commit $COMMIT after 10 minutes. Either the build is still running, the build failed, or this commit doesn't trigger an App Hosting build. Exiting without action."
  exit 0
fi

# ── 2. Check whether a rollout already references this build ──
# Healthy path: auto-rollout fires within ~60 ms of build createTime,
# so by the time the build is READY a rollout should almost always
# already exist. Poll for up to 5 more minutes as a buffer.
echo "Polling for rollout referencing $BUILD_ID..."
ROLLOUT_NAME=""
for i in $(seq 1 30); do
  ROLLOUTS_JSON=$(get "$API/rollouts?pageSize=1000") || ROLLOUTS_JSON='{}'
  ROLLOUT_NAME=$(echo "$ROLLOUTS_JSON" | jq -r --arg b "$BUILD_NAME" '
    .rollouts // []
    | map(select(.build == $b))
    | sort_by(.createTime)
    | last
    | .name // empty
  ')
  if [ -n "$ROLLOUT_NAME" ]; then
    echo "Rollout exists: $(basename "$ROLLOUT_NAME")"
    echo "Nothing to do — auto-rollout fired normally."
    exit 0
  fi
  echo "  [$i/30] No rollout yet for $BUILD_ID"
  sleep 10
done

# ── 3. Auto-create the missing rollout ──
ROLLOUT_ID="rollout-safety-net-$(date -u +%Y%m%d-%H%M%S)-${COMMIT:0:7}"
echo "::warning::App Hosting auto-rollout did not fire for build $BUILD_ID (commit $COMMIT). Creating rollout $ROLLOUT_ID manually."

CREATE_BODY=$(jq -nc --arg b "$BUILD_NAME" '{build: $b}')
CREATE_RESULT=$(get -X POST \
  -H "Content-Type: application/json" \
  -d "$CREATE_BODY" \
  "$API/rollouts?rolloutId=$ROLLOUT_ID")
echo "$CREATE_RESULT"

# Verify the create actually registered (the response is an Operation,
# not the rollout itself, so a second read is the only way to be sure)
sleep 5
VERIFY=$(get "$API/rollouts/$ROLLOUT_ID") || VERIFY=''
if ! echo "$VERIFY" | jq -e '.build' >/dev/null 2>&1; then
  echo "::error::Manual rollout POST returned success but rollout resource is not visible. Check Firebase App Hosting console."
  exit 1
fi

# ── 4. File a GitHub issue so we know the safety net fired ──
ISSUE_TITLE="Rollout safety net fired for ${COMMIT:0:7}"
ISSUE_BODY=$(printf '%s\n' \
  "Firebase App Hosting's auto-rollout did not fire for a merge to \`main\`. The rollout safety net caught it and created \`${ROLLOUT_ID}\` manually." \
  "" \
  "- **Build:** \`${BUILD_ID}\`" \
  "- **Commit:** \`${COMMIT}\`" \
  "- **Merge:** ${SERVER_URL}/${REPO}/commit/${COMMIT}" \
  "- **Created rollout:** \`${ROLLOUT_ID}\`" \
  "" \
  "This is almost certainly the same Firebase App Hosting control-plane glitch first seen on 2026-04-10 (two silent skips in one day). The deployed revision should be serving traffic normally now, but the pattern is worth tracking — if it keeps happening, escalate to Firebase support." \
  "" \
  "Upstream tracking: https://github.com/firebase/firebase-tools/issues/8866 and the Firebase status page." \
  "" \
  "_Filed automatically by \`.github/workflows/rollout-safety-net.yml\`._")

gh issue create \
  --repo "$REPO" \
  --title "$ISSUE_TITLE" \
  --body "$ISSUE_BODY" \
  --label "bug" || echo "::warning::Failed to file safety-net issue (non-fatal)"