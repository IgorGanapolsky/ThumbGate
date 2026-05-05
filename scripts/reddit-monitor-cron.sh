#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${THUMBGATE_REPO_DIR:-/Users/igorganapolsky/workspace/git/igor/ThumbGate/repo}"
LOG_FILE="${REPO_DIR}/.thumbgate/reddit-monitor.log"
NODE_BIN="${NODE_BIN:-$(command -v node)}"

mkdir -p "${REPO_DIR}/.thumbgate"

# Load environment
if [ -f "${REPO_DIR}/.env" ]; then
  while IFS='=' read -r key value; do
    # Skip comments and empty lines
    [[ -z "$key" || "$key" =~ ^# ]] && continue
    # Strip leading/trailing whitespace from key
    key=$(echo "$key" | xargs)
    # Export the variable (value preserved as-is)
    export "$key=$value"
  done < "${REPO_DIR}/.env"
fi

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Reddit monitor run starting" >> "$LOG_FILE"

cd "$REPO_DIR"
"$NODE_BIN" scripts/social-reply-monitor.js --platform=reddit >> "$LOG_FILE" 2>&1

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Reddit monitor run complete" >> "$LOG_FILE"
