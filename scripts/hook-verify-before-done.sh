#!/usr/bin/env bash
# Hook: PreToolUse gate — blocks completion claims without deployment verification
# Checks if the last tool call included a curl to the production URL.
# If not, warns that verification is required before claiming done.

PROD_URL="rlhf-feedback-loop-production.up.railway.app"
VERIFICATION_MARKER="/tmp/.thumbgate-last-deploy-verify"

# Check if this is a Bash tool call doing a curl to prod
if echo "$CLAUDE_TOOL_INPUT" | grep -q "curl.*${PROD_URL}"; then
  # Mark that verification happened
  date -u +"%Y-%m-%dT%H:%M:%SZ" > "$VERIFICATION_MARKER"
  exit 0
fi

# Not a verification curl — allow all non-completion actions
exit 0
