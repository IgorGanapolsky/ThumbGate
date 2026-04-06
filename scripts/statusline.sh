#!/bin/bash
# ThumbGate Status Line for Claude Code
# Shows ThumbGate feedback stats + most recent lesson at a glance.
# Thumbs icons trigger CLI feedback capture inline (no browser).
# Installed by: npx mcp-memory-gateway init --agent claude-code

# Resolve script directory safely (CodeQL: no uncontrolled paths)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
case "$SCRIPT_DIR" in *[!a-zA-Z0-9/_.-]*) echo "ThumbGate: invalid script path"; exit 1;; esac

# ── Parse Claude Code session JSON from stdin ─────────────────────
eval "$(cat | jq -r '
  def n(f): f // 0;
  @sh "CTX_PCT=\(n(.context_window.used_percentage) | floor)"
' 2>/dev/null)"
CTX_PCT="${CTX_PCT:-0}"

# ── ThumbGate stats from cache ────────────────────────────────────────
THUMBGATE_CACHE=""
for base in "${THUMBGATE_FEEDBACK_DIR:-.}" "." "${HOME}"; do
  for rel in ".thumbgate/statusline_cache.json" ".rlhf/statusline_cache.json"; do
    if [ -f "${base}/${rel}" ]; then
      THUMBGATE_CACHE="${base}/${rel}"
      break 2
    fi
  done
done
if [ -z "$THUMBGATE_CACHE" ]; then
  THUMBGATE_CACHE="${THUMBGATE_FEEDBACK_DIR:-.}/.thumbgate/statusline_cache.json"
fi

UP="0"; DOWN="0"; LESSONS="0"; TREND="?"; CACHE_TS="0"
if [ -f "$THUMBGATE_CACHE" ]; then
  eval "$(jq -r '
    @sh "UP=\(.thumbs_up // "0")",
    @sh "DOWN=\(.thumbs_down // "0")",
    @sh "LESSONS=\(.lessons // "0")",
    @sh "TREND=\(.trend // "?")",
    @sh "CACHE_TS=\(.updated_at // "0")"
  ' "$THUMBGATE_CACHE" 2>/dev/null)"
fi

# Background refresh from REST API when cache is stale (>120s)
_NOW=$(date +%s)
if [ $(( _NOW - ${CACHE_TS:-0} )) -gt 120 ]; then
  (
    _R=$(curl -s --max-time 3 "http://localhost:9876/v1/feedback/stats" -H "Authorization: Bearer tg_creator_dev_enterprise" 2>/dev/null)
    [ -z "$_R" ] && exit 0
    echo "$_R" | python3 -c "
import json,sys,time,os
try:
  d=json.load(sys.stdin)
  c={'thumbs_up':str(d.get('totalPositive',0)),'thumbs_down':str(d.get('totalNegative',0)),'lessons':str(d.get('rubric',{}).get('samples',0)),'approval_rate':str(round(d.get('approvalRate',0)*100,1)),'trend':d.get('trend','?'),'total_feedback':str(d.get('total',0)),'updated_at':str(int(time.time()))}
  os.makedirs(os.path.dirname('$THUMBGATE_CACHE'),exist_ok=True)
  json.dump(c,open('$THUMBGATE_CACHE','w'))
except:pass
" 2>/dev/null
  ) &>/dev/null &
  disown 2>/dev/null
fi

# ── Most recent lesson from lesson-inference ──────────────────────
LESSON_TEXT=""; LESSON_ID=""
_LESSON_JSON=$(node "${SCRIPT_DIR}/statusline-lesson.js" 2>/dev/null)
if [ -n "$_LESSON_JSON" ]; then
  eval "$(echo "$_LESSON_JSON" | jq -r '
    @sh "LESSON_TEXT=\(.text // "")",
    @sh "LESSON_ID=\(.lessonId // "")"
  ' 2>/dev/null)"
fi

# ── Control Tower stats ──────────────────────────────────────────
SLO_V="0"; AT_RISK="0"; ANOMALIES="0"
_TOWER_JSON=$(node "${SCRIPT_DIR}/statusline-tower.js" 2>/dev/null)
if [ -n "$_TOWER_JSON" ]; then
  eval "$(echo "$_TOWER_JSON" | jq -r '
    @sh "SLO_V=\(.sloViolations // 0)",
    @sh "AT_RISK=\(.atRiskToolCount // 0)",
    @sh "ANOMALIES=\(.anomalyCount // 0)"
  ' 2>/dev/null)"
fi

# ── Colors ────────────────────────────────────────────────────────
G='\033[32m'; R='\033[31m'; M='\033[35m'; C='\033[36m'; D='\033[90m'; BD='\033[1m'; RST='\033[0m'

# Trend arrow
case "${TREND}" in
  improving) ARROW="↗" ;; degrading) ARROW="↘" ;; stable) ARROW="→" ;; *) ARROW="?" ;;
esac

# ── OSC 8 clickable links ────────────────────────────────────────
# Links use CLI commands instead of browser URLs.
# Clicking 👍 runs: node bin/cli.js feedback --signal=up
# Clicking 👎 runs: node bin/cli.js feedback --signal=down
osc_link() { printf '\033]8;;%s\a%s\033]8;;\a' "$1" "$2"; }
CLI="node ${SCRIPT_DIR}/../bin/cli.js"

# ── Output (single line) ─────────────────────────────────────────
if [ "$UP" = "0" ] && [ "$DOWN" = "0" ]; then
  echo -e "${D}ThumbGate: no feedback yet — type 'thumbs up' or 'thumbs down'${RST}"
else
  # Feedback counts
  LINE="ThumbGate: ${G}${BD}${UP}${RST}👍 ${R}${BD}${DOWN}${RST}👎 · ${M}${BD}${LESSONS}${RST} lessons ${ARROW}"

  # Control Tower alerts (if any)
  [ "${SLO_V:-0}" -gt 0 ] && LINE="${LINE} ${R}${SLO_V} SLO${RST}"
  [ "${AT_RISK:-0}" -gt 0 ] && LINE="${LINE} ${R}${AT_RISK}⚠${RST}"
  [ "${ANOMALIES:-0}" -gt 0 ] && LINE="${LINE} ${R}${ANOMALIES}☠${RST}"

  # Most recent lesson
  if [ -n "$LESSON_TEXT" ]; then
    LINE="${LINE} · ${C}${LESSON_TEXT}${RST}"
  fi

  echo -e "$LINE"
fi
