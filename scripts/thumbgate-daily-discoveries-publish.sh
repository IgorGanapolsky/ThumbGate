#!/usr/bin/env bash
# thumbgate-daily-discoveries-publish.sh
# Automated daily publishing of ThumbGate news & technical discoveries.
# Invoked daily at 9:00 AM EST via crontab / launchd.

set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

echo "=== [$(date -u +"%Y-%m-%dT%H:%M:%SZ")] ThumbGate Daily Publishing Started ==="

# Execute node publishing script
node scripts/thumbgate-daily-discoveries-publish.js "$@"

echo "=== [$(date -u +"%Y-%m-%dT%H:%M:%SZ")] ThumbGate Daily Publishing Completed ==="
