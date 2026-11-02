#!/usr/bin/env bash
# After swarm-claim.py runs, record exit 3 so the next edit, commit, or push is denied.
# Called by hooks/hooks.json afterShellExecution.

set -euo pipefail

INPUT=$(cat)
RESULT=$(echo "$INPUT" | npx --yes --package thumbgate@latest thumbgate observe-tool-result 2>/dev/null) || true

if [ -z "$RESULT" ]; then
  exit 0
fi

echo "$RESULT"

if echo "$RESULT" | grep -Eq '"continue":[[:space:]]*false|"permissionDecision":[[:space:]]*"deny"'; then
  exit 2
fi

exit 0
