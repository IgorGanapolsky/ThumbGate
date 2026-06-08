#!/usr/bin/env bash
# Golden test: pre-commit hook must REJECT a commit that contains any
# of the forbidden-path families, even when staged with `git add -f`.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd -P)"
cd "$REPO_ROOT"

FORBIDDEN=(
  ".claude/implementation-notes/golden-redteam-$(date +%s).md"
  ".claude/ralph/golden-redteam-$(date +%s).md"
  "docs/marketing/golden-redteam-$(date +%s).md"
  "LAUNCH_golden_$(date +%s).md"
  "FIRST_CUSTOMER_BATTLE_PLAN.md"
)

pass=1
for rel in "${FORBIDDEN[@]}"; do
  mkdir -p "$(dirname "$rel")" 2>/dev/null || true
  echo "redteam" > "$rel"
  git add -f "$rel" >/dev/null 2>&1
  if git -c commit.gpgsign=false -c core.hooksPath=.githooks commit -m "REDTEAM" >/dev/null 2>&1; then
    echo "FAIL: pre-commit did NOT block $rel"
    pass=0
    git reset --soft HEAD^ >/dev/null 2>&1 || true
  else
    echo "ok: blocked $rel"
  fi
  git restore --staged "$rel" >/dev/null 2>&1 || true
  rm -f "$rel"
  rmdir "$(dirname "$rel")" 2>/dev/null || true
done

[ "$pass" = "1" ] && { echo "PASS"; exit 0; } || { echo "FAIL"; exit 1; }
