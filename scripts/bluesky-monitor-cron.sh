#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${THUMBGATE_REPO_DIR:-/Users/iganapolsky/workspace/ThumbGate}"
LOG_FILE="${REPO_DIR}/.thumbgate/bluesky-monitor.log"
NODE_BIN="${NODE_BIN:-$(command -v node)}"

mkdir -p "${REPO_DIR}/.thumbgate"

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Bluesky monitor run starting" >> "$LOG_FILE"

cd "$REPO_DIR"
"$NODE_BIN" scripts/social-reply-monitor-bluesky.js --auto-approve-safe >> "$LOG_FILE" 2>&1
"$NODE_BIN" scripts/social-bluesky-prospecting.js >> "$LOG_FILE" 2>&1 || true

if [[ "${THUMBGATE_BLUESKY_PUBLISH_APPROVED:-}" == "true" ]]; then
  "$NODE_BIN" scripts/social-reply-monitor-bluesky.js --publish-approved --confirm-publish >> "$LOG_FILE" 2>&1
fi

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Bluesky monitor run complete" >> "$LOG_FILE"
