#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="/Users/igorganapolsky/workspace/git/igor/rlhf"
LOG_FILE="${REPO_DIR}/.thumbgate/reddit-monitor.log"

mkdir -p "${REPO_DIR}/.rlhf"

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
/opt/homebrew/bin/node scripts/social-reply-monitor.js >> "$LOG_FILE" 2>&1

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Reddit monitor run complete" >> "$LOG_FILE"
