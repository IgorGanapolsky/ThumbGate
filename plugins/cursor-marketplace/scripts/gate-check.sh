#!/usr/bin/env bash
# Pre-action gate check — runs before risky shell commands.
# Called by hooks/hooks.json beforeShellExecution hook.
# Pipes the command as a tool-call JSON to thumbgate gate-check
# and blocks if the gate engine returns a deny verdict.
# Delegates to the published ThumbGate gate-check entrypoint.

set -euo pipefail

COMMAND="${1:-}"

if [ -n "$COMMAND" ]; then
  INPUT=$(printf '{"tool_name":"Bash","tool_input":{"command":"%s"}}' \
    "$(echo "$COMMAND" | sed 's/"/\\"/g')")
else
  INPUT=$(cat)
fi

RESULT=$(echo "$INPUT" | npx --yes --package thumbgate@latest thumbgate gate-check 2>/dev/null) || true

if [ -z "$RESULT" ] || [ "$RESULT" = "{}" ]; then
  exit 0
fi

echo "$RESULT"

if echo "$RESULT" | grep -q '"permissionDecision":\s*"deny"'; then
  echo "[gate-check] Action blocked by ThumbGate gate engine." >&2
  exit 2
fi

exit 0
