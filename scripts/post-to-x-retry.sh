#!/bin/bash
# Retry posting to X.com until it succeeds (X API v2 has frequent 503s)
# Usage: source .env && bash scripts/post-to-x-retry.sh

set -euo pipefail

MAX_RETRIES=10
RETRY_DELAY=30

for i in $(seq 1 $MAX_RETRIES); do
  echo "Attempt $i/$MAX_RETRIES..."
  if node scripts/post-to-x.js "$@" 2>&1 | grep -q "Posted tweet"; then
    echo "✅ Tweet posted successfully!"
    exit 0
  fi
  echo "  Retrying in ${RETRY_DELAY}s..."
  sleep $RETRY_DELAY
  RETRY_DELAY=$((RETRY_DELAY * 2))
done

echo "❌ Failed after $MAX_RETRIES attempts. X API may be down."
exit 1
# end
