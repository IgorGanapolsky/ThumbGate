#!/usr/bin/env bash
# thumbgate-daily-discoveries-publish.sh
# Stage the daily technical post, collect available engagement, and queue reply drafts.
# Invoked daily at 9:00 AM local time by launchd.

set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

if [[ "$#" -gt 0 ]]; then
  if [[ "$#" -eq 1 && "$1" == "--dry-run" ]]; then
    exec node scripts/thumbgate-daily-discoveries-publish.js --dry-run --stage-only --json
  fi
  echo "Usage: $0 [--dry-run]" >&2
  exit 2
fi

failures=0

run_step() {
  local name="$1"
  shift
  echo "=== [$(date -u +"%Y-%m-%dT%H:%M:%SZ")] ${name} started ==="
  if "$@"; then
    echo "=== ${name} complete ==="
  else
    local status=$?
    echo "=== ${name} failed with exit ${status} ==="
    failures=$((failures + 1))
  fi
}

run_step "Stage daily technical post" node scripts/thumbgate-daily-discoveries-publish.js --stage-only --json
run_step "Poll available engagement metrics" node scripts/social-analytics/poll-all.js
run_step "Queue Reddit and LinkedIn reply drafts" node scripts/social-reply-monitor.js
run_step "Queue Bluesky reply drafts" node scripts/social-reply-monitor-bluesky.js

if (( failures > 0 )); then
  echo "Daily social routine finished with ${failures} failed step(s). See the log for details."
  exit 1
fi

echo "Daily social routine complete. No external post or reply was sent."
