#!/usr/bin/env bash
# generate-pretool-hook.sh — PreToolUse hook for ThumbGate gate checking.
#
# Installed as a Claude Code / Codex / Gemini PreToolUse hook.
# Reads tool call JSON from stdin, pipes it to the gate-check engine,
# and outputs the result (allow/block with reason).
#
# Exit codes:
#   0 = allow (or gate-check unavailable — fail open)
#   2 = block (gate-check returned a block verdict)

set -euo pipefail

INPUT=$(cat)

# Resolve the gate-check command from the hook's shipped directory only.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATE_ENGINE="$SCRIPT_DIR/gates-engine.js"

if [ -f "$GATE_ENGINE" ]; then
  RESULT=$(echo "$INPUT" | node "$GATE_ENGINE" 2>/dev/null) || true
else
  RESULT=""
fi

# If no result, fail open (allow)
if [ -z "$RESULT" ]; then
  exit 0
fi

# Output the result for the agent to consume
echo "$RESULT"

# Check if blocked
if echo "$RESULT" | grep -q '"permissionDecision":\s*"deny"'; then
  exit 2
fi

exit 0
