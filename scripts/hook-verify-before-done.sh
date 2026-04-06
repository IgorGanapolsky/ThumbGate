#!/usr/bin/env bash
# Hook: PreToolUse (matcher: Bash)
#
# When it fires: Before every Bash tool call in Claude Code.
# What it does:  If the Bash command contains a curl to production,
#                records the timestamp to a marker file.
# Why:           The Stop hook (hook-stop-verify-deploy.sh) checks this
#                marker to warn if no prod verification happened.
# Env vars:
#   CLAUDE_TOOL_INPUT — the Bash command about to execute (set by Claude Code)
# Exit code: Always 0 (never blocks tool calls).

PROD_URL="thumbgate-production.up.railway.app"
VERIFICATION_MARKER="/tmp/.thumbgate-last-deploy-verify"

if echo "${CLAUDE_TOOL_INPUT:-}" | grep -q "curl.*${PROD_URL}"; then
  date -u +"%Y-%m-%dT%H:%M:%SZ" > "$VERIFICATION_MARKER"
fi

exit 0
