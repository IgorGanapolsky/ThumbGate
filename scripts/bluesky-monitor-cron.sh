#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${THUMBGATE_REPO_DIR:-/Users/igorganapolsky/workspace/git/igor/ThumbGate/repo}"
LOG_FILE="${REPO_DIR}/.thumbgate/bluesky-monitor.log"
NODE_BIN="${NODE_BIN:-$(command -v node)}"

mkdir -p "${REPO_DIR}/.thumbgate"

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Bluesky monitor run starting" >> "$LOG_FILE"

cd "$REPO_DIR"
"$NODE_BIN" scripts/social-reply-monitor-bluesky.js >> "$LOG_FILE" 2>&1

if [ "${THUMBGATE_BLUESKY_PUBLISH_APPROVED:-}" = "true" ]; then
  "$NODE_BIN" scripts/social-reply-monitor-bluesky.js --publish-approved --confirm-publish >> "$LOG_FILE" 2>&1
fi

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Bluesky monitor run complete" >> "$LOG_FILE"
