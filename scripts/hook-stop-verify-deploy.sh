#!/usr/bin/env bash
# Hook: Stop
#
# When it fires: After Claude finishes responding (every turn).
# What it does:  Checks if a curl to production happened this session.
#                If not, prints a warning reminding the CTO to verify.
# Why:           Prevents saying "deployed" without proof.
# Env vars:
#   CLAUDE_STOP_REASON — why the agent stopped (set by Claude Code)
# Marker file:
#   /tmp/.thumbgate-last-deploy-verify — written by hook-verify-before-done.sh
# Exit code: Always 0 (informational only).

PROD_URL="rlhf-feedback-loop-production.up.railway.app"
VERIFICATION_MARKER="/tmp/.thumbgate-last-deploy-verify"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
EXPECTED_VERSION="$(node -e "console.log(require(process.argv[1]).version)" "${REPO_ROOT}/package.json")"

if [ -f "$VERIFICATION_MARKER" ]; then
  VERIFY_TIME=$(cat "$VERIFICATION_MARKER")
  echo "✅ Last deployment verification: $VERIFY_TIME"
else
  echo "⚠️  WARNING: No deployment verification found this session."
  echo "   If you deployed to Railway, run:"
  echo "   curl -s https://${PROD_URL}/health | grep '\"version\":\"${EXPECTED_VERSION}\"'"
  echo "   curl -s https://${PROD_URL}/dashboard | grep 'ThumbGate Dashboard'"
  echo "   before claiming done."
fi

exit 0
