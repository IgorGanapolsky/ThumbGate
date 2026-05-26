#!/usr/bin/env bash
# Revenue Truth Bootstrap — runs at SessionStart.
# Thin wrapper around the canonical scripts/revenue-status.js pipeline so
# this hook stays in sync with however the rest of the codebase resolves
# billing credentials. Never logs secret values.

set -u
set -o pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"

echo "=== ThumbGate revenue-truth bootstrap ==="

# Auth priority chain matches scripts/operational-summary.js +
# scripts/revenue-status.js exactly:
#   1. $THUMBGATE_OPERATOR_KEY (read-only billing-summary access)
#   2. ~/.config/thumbgate/operator.json (CLI-provisioned)
#   3. $THUMBGATE_API_KEY (full admin)
KEY_SOURCE="none"
if [ -n "${THUMBGATE_OPERATOR_KEY:-}" ]; then
  KEY_SOURCE="env:THUMBGATE_OPERATOR_KEY"
elif [ -f "${HOME}/.config/thumbgate/operator.json" ]; then
  KEY_SOURCE="file:~/.config/thumbgate/operator.json"
elif [ -n "${THUMBGATE_API_KEY:-}" ]; then
  KEY_SOURCE="env:THUMBGATE_API_KEY"
fi

echo "Auth source: ${KEY_SOURCE}"

if [ "${KEY_SOURCE}" = "none" ]; then
  cat <<'EOF'

NO LIVE REVENUE NUMBERS THIS SESSION.

How to fix (one-time, persists for future sessions):
  Option A — generate an operator key via the CLI:
    node bin/cli.js billing:setup
    (writes ~/.config/thumbgate/operator.json on this machine)

  Option B — paste an existing operator key into the harness env:
    THUMBGATE_OPERATOR_KEY=tg_op_...   # read-only, recommended for agents
  OR the full admin key:
    THUMBGATE_API_KEY=tg_...            # admin, only if operator unavailable

The harness env is the agent container's env, not Railway's server env.
Railway holds the server-side copy that signs /v1/billing/summary; the
agent needs its own copy to call that endpoint.

Until a key is present, treat any revenue number as historical (cite
docs/VERIFICATION_EVIDENCE.md with the snapshot date).
EOF
  exit 0
fi

# Defer to the canonical pipeline so this hook can never drift again.
( cd "${ROOT}" && node scripts/revenue-status.js 2>&1 ) | sed 's/^/  /'
