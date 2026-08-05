#!/usr/bin/env bash
# Lightweight structural checks for skills/gates/workflows about to ship.
# Usage: check_context_layers.sh [file ...]
set -euo pipefail

FAIL=0
check_skill() {
  local f="$1"
  [[ -f "$f" ]] || return 0
  if ! rg -q '^name:' "$f"; then echo "FAIL $f: missing name frontmatter"; FAIL=1; fi
  if ! rg -q '^description:' "$f"; then echo "FAIL $f: missing description"; FAIL=1; fi
  if ! rg -qi 'NEVER|ALWAYS|HARD' "$f"; then echo "WARN $f: no NEVER/ALWAYS/HARD table"; fi
  if rg -qi 'lastFiredAt|force-gate|gate' "$f" && ! rg -qi 'matchable|tool.?name|surface|PreToolUse|gate-check' "$f"; then
    echo "WARN $f: mentions gates but not matchable surfaces"
  fi
  echo "OK skill shape: $f"
}

check_gate_json() {
  local f="$1"
  [[ -f "$f" ]] || return 0
  if rg -q 'outbound-email-send|"action": "block"' "$f"; then
    echo "OK gate config present: $f"
  fi
}

if [[ $# -eq 0 ]]; then
  set -- \
    "$HOME/.grok/skills/context-engineering-checklist/SKILL.md" \
    "$HOME/.grok/skills/gsd-ralph-context-loop/SKILL.md" \
    "$HOME/.grok/skills/three-bus-ship-cycle/SKILL.md"
fi

for f in "$@"; do
  case "$f" in
    */SKILL.md|*/skill.md) check_skill "$f" ;;
    *.json) check_gate_json "$f" ;;
    *) echo "SKIP $f" ;;
  esac
done

if [[ "$FAIL" -ne 0 ]]; then
  echo "CONTEXT LAYERS: FAIL"
  exit 1
fi
echo "CONTEXT LAYERS: PASS"
exit 0
