#!/bin/bash
# Configure Firestore TTL policies for automatic document cleanup.
# Run once per project. Requires gcloud CLI with appropriate permissions.
#
# TTL policies:
#   workers collection: 24h (heartbeat docs auto-expire)
#   idempotencyKeys collection: 7d (dedup keys auto-expire)

set -euo pipefail

PROJECT="${GOOGLE_CLOUD_PROJECT:-magic-bracket-simulator}"

echo "Setting up Firestore TTL policies for project: $PROJECT"

# Workers collection: TTL on 'ttl' field (24h from last heartbeat)
gcloud firestore fields ttls update ttl \
  --collection-group=workers \
  --project="$PROJECT" \
  --quiet 2>/dev/null || echo "Workers TTL policy already exists or update submitted"

# Idempotency keys: TTL on 'ttl' field (7 days from creation)
gcloud firestore fields ttls update ttl \
  --collection-group=idempotencyKeys \
  --project="$PROJECT" \
  --quiet 2>/dev/null || echo "IdempotencyKeys TTL policy already exists or update submitted"

echo "Done. TTL policies may take up to 24h to fully activate."
echo ""
echo "To apply GCS lifecycle rules for raw logs (30-day deletion):"
echo "  gsutil lifecycle set infra/gcs-lifecycle.json gs://\$GCS_BUCKET"
