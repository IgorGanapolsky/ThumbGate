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
# Capture output to detect the stale-key case (key configured but pipeline
# still falls back to Source: local-fallback because the configured key no
# longer authenticates against Railway after a rotation). Without this, every
# cloud session sees a multi-line 401 nag in the SessionStart bootstrap and
# re-derives "operator key mismatch is a blocker" — it isn't, it's the
# expected posture for any session that doesn't hold the Railway key.
RAW="$( cd "${ROOT}" && node scripts/revenue-status.js 2>&1 )"
RC=$?

if echo "$RAW" | grep -qE "Source: local-fallback|Hosted summary working: no"; then
  # Stale or insufficient credential. Show the live numbers (still valid
  # local lesson DB readings, just not Stripe-reconciled) and replace the
  # 401-shaped Gaps lines with a single one-liner so it stops reading as a
  # blocker.
  echo "$RAW" \
    | grep -vE "^[[:space:]]*- spawnSync gh ENOENT$" \
    | grep -vE "^[[:space:]]*- Hosted billing summary today returned 401$" \
    | grep -vE "^[[:space:]]*- Hosted billing summary rejected credentials \(HTTP 401\)" \
    | grep -vE "^[[:space:]]*- local operational billing summary is unavailable$" \
    | sed 's/^/  /'
  cat <<EOF

  ${KEY_SOURCE}: authenticated against LOCAL fallback (not hosted Railway
  summary). Numbers above are local lesson DB readings, not Stripe-
  reconciled hosted revenue. EXPECTED posture for any session that does
  not hold the rotated Railway operator key — not a blocker. To see
  hosted truth, run \`node bin/cli.js billing:setup\` from a machine
  that can write to ~/.config/thumbgate/operator.json. Do NOT paste the
  key into chat or argv (CLAUDE.md hard-block rule #2).
EOF
  exit 0
fi

# Happy path: hosted summary authenticated. Print full pipeline output as
# the original script did.
echo "$RAW" | sed 's/^/  /'
exit $RC
