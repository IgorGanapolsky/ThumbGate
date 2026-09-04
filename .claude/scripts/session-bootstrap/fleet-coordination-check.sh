#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# fleet-coordination-check.sh — mandatory session-start coordination sweep.
#
# Runs ONCE per session start (wired into .claude/settings.json SessionStart).
# Surfaces which OTHER agents own what, so we never mutate shared state under
# a live claim. Read-only: prints findings; NEVER mutates vault/Linear/GitHub.
#
# Exit codes: 0 = all clear / degraded surfaces recorded (continue),
#             2 = HARD blocker (another live agent holds THIS checkout's lease
#                 or an active vault claim covers THIS repo right now).
# ---------------------------------------------------------------------------
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
VAULT="${AI_AGENT_SYNC_VAULT:-$HOME/Documents/AI-Agent-Sync}"

# Fail closed: shared hostname-unknown identity would skip foreign leases.
if [ -z "${THUMBGATE_SESSION_AGENT:-}" ]; then
  echo "BLOCKER: THUMBGATE_SESSION_AGENT unset. Export a unique session id before mutating shared state."
  exit 2
fi
SESSION_AGENT="$THUMBGATE_SESSION_AGENT"

echo "=== Fleet Coordination Check (session: ${SESSION_AGENT}) ==="

# 1) Checkout lease via canonical checker (exit 1 = foreign live lease).
# scripts/session-lease.js check: 0 = ours/none-or-stale reclaimable, 1 = foreign live.
if [ -f "$REPO_ROOT/scripts/session-lease.js" ]; then
  CHECK_OUT="$(cd "$REPO_ROOT" && THUMBGATE_SESSION_AGENT="$SESSION_AGENT" node scripts/session-lease.js check 2>&1)"
  CHECK_RC=$?
  if [ "$CHECK_RC" -eq 1 ]; then
    echo "BLOCKER: $CHECK_OUT"
    echo "Use a separate worktree (git worktree add) instead of mutating this checkout."
    exit 2
  fi
  echo "lease: $CHECK_OUT (rc=$CHECK_RC) OK"
elif [ -f "$REPO_ROOT/.git/thumbgate-session-lease.json" ]; then
  # Fallback: pass path as argv data (never interpolate into JS source).
  LEASE_PATH="$REPO_ROOT/.git/thumbgate-session-lease.json"
  LEASE_AGENT="$(node -e "const fs=require('fs');const l=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(l.agent||'unknown')" "$LEASE_PATH" 2>/dev/null || echo unknown)"
  echo "lease: file present agent=$LEASE_AGENT (canonical checker missing — claim/check manually)"
else
  echo "lease: none present - claim before mutating shared state"
fi

# 2) Vault running claims touching this repo -------------------------------
echo "--- Vault claims (AI-Agent-Sync) ---"
if [ -d "$VAULT/Agent-Jobs/running" ]; then
  CLAIMS="$(grep -rilE 'ThumbGate|thumbgate' "$VAULT/Agent-Jobs/running" 2>/dev/null | grep -v '.thumbgate' || true)"
  if [ -n "$CLAIMS" ]; then
    echo "$CLAIMS" | while read -r f; do
      echo "  claim: $(basename "$f")"
      # Show the claimed repo/scope line if present
      grep -iE 'repository|repo|scope|project' "$f" 2>/dev/null | head -2 | sed 's/^/    /'
    done
  else
    echo "  none"
  fi
else
  echo "  vault Agent-Jobs/running missing (VAULT=$VAULT)"
fi

# 3) Vault dirty state (who is mid-flight) ---------------------------------
if [ -d "$VAULT/.git" ]; then
  DIRTY="$(git -C "$VAULT" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
  # Modified coordination files signal live writers; list the most recent few
  RECENT="$(git -C "$VAULT" status --porcelain 2>/dev/null | grep -E 'Agent-State|Handoffs|Agent-Jobs/running' | head -5 || true)"
  echo "vault dirty files: $DIRTY"
  if [ -n "$RECENT" ]; then
    echo "  recent coordination writes:"
    echo "$RECENT" | sed 's/^/    /'
  fi
fi

# 4) Live agents via herdr (if gateway up) ---------------------------------
if command -v herdr >/dev/null 2>&1; then
  if herdr status 2>/dev/null | grep -q 'status: running'; then
    echo "--- Live agents (herdr) ---"
    herdr agent list 2>/dev/null | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    agents = d.get('agents', d if isinstance(d, list) else [])
    for a in agents:
        cwd = a.get('cwd','')
        print(f\"  {a.get('id','?')} state={a.get('state','?')} cwd={cwd} title={(a.get('terminal_title') or '')[:60]}\")
except Exception:
    pass
" || herdr agent list 2>/dev/null | head -10
  else
    echo "herdr: gateway not running (no live pane view)"
  fi
fi

# 5) Linear in-progress issues touching this repo --------------------------
KEY_FILE="$HOME/.config/linear/api_key"
if [ -f "$KEY_FILE" ]; then
  echo "--- Linear in-flight issues (thumbgate/radware/circuit/hygiene) ---"
  KEY="$(cat "$KEY_FILE")"
  curl -s -m 8 -X POST https://api.linear.app/graphql \
    -H "Content-Type: application/json" -H "Authorization: $KEY" \
    -d '{"query":"{ issues(filter: { and: [ { updatedAt: { gte: \"2026-09-01T00:00:00.000Z\" } }, { or: [ { title: { containsIgnoreCase: \"thumbgate\" } }, { title: { containsIgnoreCase: \"radware\" } }, { title: { containsIgnoreCase: \"circuit breaker\" } }, { title: { containsIgnoreCase: \"pr hygiene\" } } ] }, { state: { name: { in: [\"In Progress\",\"In Review\"] } } } ] }, first: 10) { nodes { identifier title state { name } } } }"}' 2>/dev/null \
    | python3 -c "
import sys, json
try:
    nodes = json.load(sys.stdin)['data']['issues']['nodes']
    for n in nodes:
        print(f\"  {n['identifier']} [{n['state']['name']}] {n['title'][:70]}\")
    if not nodes:
        print('  none')
except Exception as e:
    print(f'  linear query failed: {e}')
" || echo "  linear unreachable"
else
  echo "linear: no api_key at ~/.config/linear/api_key"
fi

# 6) Open PRs on this repo (quick census) ----------------------------------
if command -v gh >/dev/null 2>&1; then
  echo "--- Open PR census ---"
  if PRS="$(gh pr list --repo IgorGanapolsky/ThumbGate --state open --limit 100 \
    --json number,mergeStateStatus,headRefName \
    --jq '.[] | "#\(.number) [\(.mergeStateStatus)] \(.headRefName)"' 2>/dev/null)"; then
    if [ -n "$PRS" ]; then
      echo "$PRS" | sed 's/^/  /'
    else
      echo "  none open"
    fi
  else
    echo "  gh pr list failed (auth or network)"
  fi
fi

echo "=== Coordination sweep complete ==="
exit 0
