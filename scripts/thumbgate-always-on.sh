#!/usr/bin/env bash
# One ThumbGate promotion pass. Safe to run from cron more than once a day.
# The publisher skips a date that is already in the daily ledger.
# This script does not send email.

set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"

REPO="/Users/iganapolsky/workspace/ThumbGate"
LOG="${HOME}/Library/Logs/thumbgate-always-on.log"
LOCKDIR="${HOME}/Library/Logs/thumbgate-always-on.lockdir"

mkdir -p "${HOME}/Library/Logs"

if ! mkdir "${LOCKDIR}" 2>/dev/null; then
  if [ -d "${LOCKDIR}" ]; then
    now=$(date +%s)
    mtime=$(stat -f %m "${LOCKDIR}" 2>/dev/null || echo "${now}")
    if [ $((now - mtime)) -gt 1800 ]; then
      rmdir "${LOCKDIR}" 2>/dev/null || true
      mkdir "${LOCKDIR}" 2>/dev/null || {
        echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) skip: lock held" >> "${LOG}"
        exit 0
      }
    else
      echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) skip: lock held" >> "${LOG}"
      exit 0
    fi
  fi
fi
trap 'rmdir "${LOCKDIR}" 2>/dev/null || true' EXIT

{
  echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) ThumbGate always-on start ==="
  cd "${REPO}"
  node scripts/thumbgate-daily-discoveries-publish.js --json
  node scripts/coderlegion-sentinel.js --json || true
  echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) ThumbGate always-on done ==="
} >> "${LOG}" 2>&1
