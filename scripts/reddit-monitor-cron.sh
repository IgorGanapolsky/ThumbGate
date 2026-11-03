#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${THUMBGATE_REPO_DIR:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"
LOG_FILE="${REPO_DIR}/.thumbgate/reddit-monitor.log"
NODE_BIN="${NODE_BIN:-$(command -v node)}"
export THUMBGATE_CHROME_CDP_ENDPOINT="${THUMBGATE_CHROME_CDP_ENDPOINT:-http://127.0.0.1:9114}"

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
"$NODE_BIN" scripts/reddit-browser-notification-watch.js >> "$LOG_FILE" 2>&1 || true
"$NODE_BIN" scripts/social-reply-monitor.js --platform=reddit >> "$LOG_FILE" 2>&1 || true
echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Reddit monitor run complete" >> "$LOG_FILE"
