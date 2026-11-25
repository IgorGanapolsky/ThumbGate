#!/usr/bin/env bash
# One wrapper for the Cursor hooks that need ThumbGate's own JSON answer:
#   cursor-hook.sh mcp-gate   beforeMCPExecution: holds after a thumbs-down, chat send rules; deny = exit 2
#   cursor-hook.sh record     afterShellExecution / afterMCPExecution / afterAgentResponse: record the turn
#   cursor-hook.sh stop       stop: an unchecked status claim gets one follow-up message sending the agent to check
# THUMBGATE_CLI overrides the command for tests.

set -uo pipefail

SUB="${1:-}"
case "$SUB" in
  mcp-gate) CMD="cursor-mcp-gate" ;;
  record) CMD="cursor-record" ;;
  stop) CMD="cursor-stop" ;;
  *) echo '{}'; exit 0 ;;
esac

INPUT=$(cat)
if [ -n "${THUMBGATE_CLI:-}" ]; then
  RESULT=$(echo "$INPUT" | ${THUMBGATE_CLI} "$CMD" 2>/dev/null)
else
  RESULT=$(echo "$INPUT" | npx --yes --package thumbgate@latest thumbgate "$CMD" 2>/dev/null)
fi
STATUS=$?

if [ -z "$RESULT" ]; then
  if [ "$CMD" = "cursor-mcp-gate" ]; then echo '{"permission":"allow"}'; else echo '{}'; fi
  exit 0
fi
echo "$RESULT"
if [ "$CMD" = "cursor-mcp-gate" ] && { [ "$STATUS" -eq 2 ] || echo "$RESULT" | grep -Eq '"permission":[[:space:]]*"deny"'; }; then
  exit 2
fi
exit 0
