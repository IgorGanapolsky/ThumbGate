#!/usr/bin/env bash
# Pre-action gate check: runs before EVERY shell command Cursor executes (no keyword matcher in hooks.json, because a
# matcher skipped aws s3 rm, terraform destroy and kubectl delete). Delegates to the published ThumbGate Cursor adapter,
# which turns Cursor's {"command": ...} into a gate-check call and answers {"permission": "allow" | "deny"}.
# THUMBGATE_CLI overrides the command for tests.

set -uo pipefail

INPUT=$(cat)
if [ -n "${THUMBGATE_CLI:-}" ]; then
  RESULT=$(echo "$INPUT" | ${THUMBGATE_CLI} cursor-gate 2>/dev/null)
else
  RESULT=$(echo "$INPUT" | npx --yes --package thumbgate@latest thumbgate cursor-gate 2>/dev/null)
fi

# Fail closed (AGENT-3667): no answer, a failed command or anything that is not a permission decision means the gate
# could not check this command, so it is denied. Only an explicit allow lets it run.
if ! echo "$RESULT" | grep -Eq '"permission":[[:space:]]*"(allow|deny)"'; then
  echo '{"permission":"deny","user_message":"ThumbGate could not check this command, so it was blocked. Retry; if it keeps failing run: npx thumbgate doctor","agent_message":"ThumbGate gate unavailable: command blocked (fail closed)."}'
  exit 2
fi

echo "$RESULT"

if echo "$RESULT" | grep -q '"permission":[[:space:]]*"deny"'; then
  exit 2
fi

exit 0
