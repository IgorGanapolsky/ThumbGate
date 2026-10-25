#!/usr/bin/env bash
# egm-session-start.sh — SessionStart hook for Claude Code.
#
# Enforces the Agent Self-Improvement Protocol (ASIP) at session start.
# Runs the EGM cycle: Elephant (deep context) → check prevention rules → output guidance.
#
# This hook is NON-BLOCKING — it exits 0 and outputs context via stdout.
# Claude Code prepends this context to the agent's first turn.

# Do NOT use set -e — hooks must never block the agent session.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
THUMBGATE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VAULT_ROOT="${AI_AGENT_SYNC_VAULT:-$HOME/Documents/AI-Agent-Sync}"

# 1. Run the existing agent-loop health check (non-blocking)
HEALTH_OK="unknown"
if HEALTH_RAW=$(node "$THUMBGATE_ROOT/bin/agent-loop" --health --json 2>/dev/null); then
  HEALTH_OK=$(echo "$HEALTH_RAW" | python3 -c "import json,sys; print(json.load(sys.stdin)['status'])" 2>/dev/null || echo "unknown")
fi

# 2. Check for active prevention rules from recent feedback (non-blocking)
FEEDBACK_LINES=""
if [ -d "$VAULT_ROOT/.claude/memory/feedback" ]; then
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    LINE=$(python3 -c "
import json
try:
    d = json.load(open('$f'))
    signal = d.get('signal', '?')
    ctx = d.get('context', d.get('whatWentWrong', 'unknown'))[:120]
    promoted = 'PROMOTED' if d.get('promoted') else 'logged'
    print(f'- {signal.upper()}: {ctx} [{promoted}]')
except:
    pass
" 2>/dev/null || true)
    if [ -n "$LINE" ]; then
      FEEDBACK_LINES="${FEEDBACK_LINES}${LINE}\n"
    fi
  done < <(find "$VAULT_ROOT/.claude/memory/feedback" -name '*.json' -mtime -1 2>/dev/null | head -5)
fi

# 3. Fleet coordination (non-blocking — may be absent in fresh sessions)
FLEET_STATUS="Fleet check: THUMBGATE_SESSION_AGENT not set (run \`npm run session:lease:claim\` before mutating shared state)"
if [ -n "${THUMBGATE_SESSION_AGENT:-}" ]; then
  FLEET_STATUS=$(bash "$THUMBGATE_ROOT/.claude/scripts/session-bootstrap/fleet-coordination-check.sh" 2>&1 | tail -3)
fi

# 4. Output EGM session-start context
cat <<EGMMD

## EGM Session Start — Agent Self-Improvement Protocol

**System Status:** $(echo "$HEALTH_OK" | tr '[:lower:]' '[:upper:]')
**Operating Rhythm:** Recollect → Plan → Observe → Act → Evaluate → Learn
**Verification Standard:** Evidence-first — every claim verified before declaration.

**Current Phase Guidance:**
- **Elephant**: Full context loaded. AGENTS.md, CLAUDE.MD, GEMINI.MD read. Fleet coordination checked.
- **Goldfish**: Every task will be reviewed from a zero-context perspective before completion.
- **Engineer**: Only act after Elephant+Goldfish pass. Stage explicit paths. Verify before claiming done.

**Safety Boundaries (fail-closed):**
- NEVER approve PRs or bypass branch protection
- NEVER spend money without purchase requisition
- NEVER touch ECI domains from non-ECI workflows
- NEVER git add -A in shared checkouts

EGMMD

if [ -n "$FEEDBACK_LINES" ]; then
  echo "### Recent Feedback (last 24h)"
  echo -e "$FEEDBACK_LINES"
  echo ""
fi

echo "### Fleet Coordination"
echo "$FLEET_STATUS"
echo ""

exit 0
