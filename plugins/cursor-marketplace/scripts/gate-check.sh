#!/usr/bin/env bash
# Pre-action gate check — runs before risky shell commands.
# Called by hooks/hooks.json beforeShellExecution hook.
# Pipes the command as a tool-call JSON to thumbgate gate-check
# and blocks if the gate engine returns a deny verdict.

set -euo pipefail

COMMAND="${1:-}"

# Build a tool-call JSON payload matching the PreToolUse hook interface
INPUT=$(printf '{"tool_name":"Bash","tool_input":{"command":"%s"}}' \
  "$(echo "$COMMAND" | sed 's/"/\\"/g')")

RESULT=$(echo "$INPUT" | npx -y thumbgate@latest gate-check 2>/dev/null) || true

# If no result or empty, allow
if [ -z "$RESULT" ] || [ "$RESULT" = "{}" ]; then
  exit 0
fi

# Output result for the agent
echo "$RESULT"

# Block if denied
if echo "$RESULT" | grep -q '"permissionDecision"'; then
  echo "[gate-check] Action blocked by ThumbGate gate engine." >&2
  exit 1
fi

exit 0
