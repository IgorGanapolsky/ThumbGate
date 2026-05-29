#!/usr/bin/env bash
# bin/revenue-truth.sh
#
# Wrapper around `npm run revenue:status` that NEVER asks for the operator key
# to be pasted into a chat, a session log, or this script's argv. Designed for
# the case where a cloud Claude Code session (or any non-CEO-laptop shell)
# would otherwise repeatedly 401 and the agent would describe the 401 as a
# blocker forever.
#
# Decision tree:
#   1. Operator key already configured (env OR ~/.config/thumbgate/operator.json)
#      → run the canonical revenue-status pipeline.
#   2. Operator key NOT configured but the shell is on a personal machine
#      (THUMBGATE_LOCAL_OK=1 OR macOS-like markers)
#      → print the exact `bin/cli.js billing:setup` flow that writes the key
#        to ~/.config/thumbgate/operator.json from a one-time browser dance.
#   3. Operator key NOT configured AND the shell looks like a cloud agent
#      (CI=true, CODESPACES=true, /home/user/ThumbGate path on Linux container)
#      → print a friendly "this is a local-only operation, here is how to run
#        it from your own machine" message and exit 0 (do NOT throw).
#
# Refuses to accept the operator key as a CLI argument or stdin paste — that
# would leak it into shell history and the agent transcript.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OPERATOR_FILE="${HOME}/.config/thumbgate/operator.json"

color_warn=$'\033[33m'
color_ok=$'\033[32m'
color_dim=$'\033[2m'
color_reset=$'\033[0m'

if [[ "$#" -gt 0 ]]; then
  echo "${color_warn}bin/revenue-truth.sh does not accept arguments.${color_reset}" >&2
  echo "  The operator key MUST come from \$THUMBGATE_OPERATOR_KEY or ${OPERATOR_FILE}." >&2
  echo "  Pasting the key on the command line would leak it to shell history." >&2
  exit 64
fi

have_env_key=0
have_file_key=0
if [[ -n "${THUMBGATE_OPERATOR_KEY:-}" ]]; then have_env_key=1; fi
if [[ -f "$OPERATOR_FILE" ]]; then
  # crude check — just confirm the file exists and is non-empty; do not read the value
  if [[ -s "$OPERATOR_FILE" ]]; then have_file_key=1; fi
fi

if [[ "$have_env_key" -eq 1 || "$have_file_key" -eq 1 ]]; then
  echo "${color_ok}Operator key detected. Querying live billing summary…${color_reset}"
  cd "$REPO_ROOT"
  tmp_out="$(mktemp -t revenue-truth.XXXXXX)"
  trap 'rm -f "$tmp_out"' EXIT
  set +e
  node scripts/revenue-status.js "$@" | tee "$tmp_out"
  rc=${PIPESTATUS[0]}
  set -e
  # Even when the canonical pipeline returns exit 0, it may fall back to local
  # if the configured operator key is stale (existing file or env var that no
  # longer authenticates against Railway). Surface that case loudly instead of
  # silently letting another session conclude "we have no traffic."
  if grep -qE "Source: local-fallback|Hosted summary working: no" "$tmp_out"; then
    cat >&2 <<EOF

${color_warn}WARNING — configured operator key authenticated against the LOCAL fallback,${color_reset}
${color_warn}not the hosted Railway billing summary. The numbers above are the local${color_reset}
${color_warn}lesson DB, not Stripe-reconciled hosted truth.${color_reset}

Likely causes:
  - The operator key in $OPERATOR_FILE (or \$THUMBGATE_OPERATOR_KEY) is stale.
  - Railway rotated THUMBGATE_OPERATOR_KEY and this machine still has the old value.

Fix on the CEO's local machine (do NOT paste the key into any chat session):
  node bin/cli.js billing:setup   # writes a fresh key to $OPERATOR_FILE

After re-running setup, re-run \`bin/revenue-truth.sh\`. If \`Source:\`
becomes \`hosted-billing-summary\`, the rotation worked.
EOF
  fi
  exit "$rc"
fi

# No key. Determine which guidance to print.
looks_like_cloud_agent=0
if [[ -n "${CI:-}" || -n "${CODESPACES:-}" || -n "${GITHUB_ACTIONS:-}" || -n "${CLAUDE_CODE_REMOTE:-}" ]]; then
  looks_like_cloud_agent=1
fi
if [[ "$looks_like_cloud_agent" -eq 0 && "$(uname -s 2>/dev/null || echo unknown)" == "Linux" && "${PWD:-}" =~ ^/home/user/ ]]; then
  # Heuristic: the cloud-execution containers we use are Linux + /home/user/...
  looks_like_cloud_agent=1
fi

cat >&2 <<EOF
${color_warn}No THUMBGATE_OPERATOR_KEY found.${color_reset}
  - \$THUMBGATE_OPERATOR_KEY:           $( [[ "$have_env_key" -eq 1 ]] && echo set || echo unset )
  - ${OPERATOR_FILE}: $( [[ "$have_file_key" -eq 1 ]] && echo present || echo missing )

EOF

if [[ "$looks_like_cloud_agent" -eq 1 ]]; then
  cat >&2 <<EOF
${color_warn}This shell looks like a cloud / CI session.${color_reset}
  Revenue truth is a LOCAL operation by design: the operator key lives on
  the CEO's laptop and on Railway, never in a cloud Claude Code session.

  To unblock: run this same command from your local terminal, where
  \`~/.config/thumbgate/operator.json\` already exists. Do NOT paste the
  operator key into this session.

  Exiting 0 — this is the expected posture for cloud sessions, not a bug.
EOF
  exit 0
fi

cat >&2 <<EOF
${color_warn}One-time local setup (writes the key to a file on your machine, never to chat or git):${color_reset}

    node bin/cli.js billing:setup

  This walks an OAuth-style dance with the hosted Railway deployment and
  writes the operator key to ${OPERATOR_FILE} with 0600 perms. After it
  completes, re-run this script.

${color_dim}Alternative (advanced): export THUMBGATE_OPERATOR_KEY=<value> in your
shell rc file. Do not paste it into chat. Do not commit it.${color_reset}
EOF
exit 1
