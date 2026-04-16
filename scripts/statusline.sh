#!/bin/bash
# ThumbGate Status Line for Claude Code and Codex
# Shows ThumbGate feedback stats + package version/tier at a glance.
# Installed by: npx thumbgate init --agent claude-code|codex

# Resolve script directory safely (CodeQL: no uncontrolled paths)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
case "$SCRIPT_DIR" in *[!a-zA-Z0-9/_.-]*) echo "ThumbGate: invalid script path"; exit 1;; esac
LOCAL_API_ORIGIN="${THUMBGATE_LOCAL_API_ORIGIN:-http://localhost:3456}"

# ── Parse Claude Code session JSON from stdin ─────────────────────
eval "$(cat | jq -r '
  def n(f): f // 0;
  @sh "CTX_PCT=\(n(.context_window.used_percentage) | floor)",
  @sh "PROJECT_CWD=\(.cwd // .working_directory // "")"
' 2>/dev/null)"
CTX_PCT="${CTX_PCT:-0}"
PROJECT_CWD="${PROJECT_CWD:-}"

if [ -n "$PROJECT_CWD" ] && [ -d "$PROJECT_CWD" ]; then
  export THUMBGATE_PROJECT_DIR="$PROJECT_CWD"
  if [ -z "${THUMBGATE_FEEDBACK_DIR:-}" ]; then
    export THUMBGATE_FEEDBACK_DIR="${PROJECT_CWD}/.claude/memory/feedback"
  fi
fi

# ── ThumbGate stats from cache ────────────────────────────────────────
THUMBGATE_CACHE=""
_CACHE_CANDIDATES_JSON=$(node "${SCRIPT_DIR}/statusline-cache-path.js" 2>/dev/null)
if [ -n "$_CACHE_CANDIDATES_JSON" ]; then
  while IFS= read -r candidate; do
    [ -z "$candidate" ] && continue
    if [ -f "$candidate" ]; then
      THUMBGATE_CACHE="$candidate"
      break
    fi
  done < <(echo "$_CACHE_CANDIDATES_JSON" | jq -r '.candidates[]?' 2>/dev/null)
fi
if [ -z "$THUMBGATE_CACHE" ]; then
  THUMBGATE_CACHE="$(echo "$_CACHE_CANDIDATES_JSON" | jq -r '.candidates[0] // empty' 2>/dev/null)"
fi
if [ -z "$THUMBGATE_CACHE" ]; then
  THUMBGATE_CACHE="${THUMBGATE_FEEDBACK_DIR:-.}/statusline_cache.json"
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

_NOW=$(date +%s)
if [ "$UP" = "0" ] && [ "$DOWN" = "0" ] || [ $(( _NOW - ${CACHE_TS:-0} )) -gt 120 ]; then
  _LOCAL_STATS_JSON=$(node "${SCRIPT_DIR}/statusline-local-stats.js" 2>/dev/null)
  if [ -n "$_LOCAL_STATS_JSON" ]; then
    mkdir -p "$(dirname "$THUMBGATE_CACHE")"
    printf '%s' "$_LOCAL_STATS_JSON" > "$THUMBGATE_CACHE"
    eval "$(echo "$_LOCAL_STATS_JSON" | jq -r '
      @sh "UP=\(.thumbs_up // "0")",
      @sh "DOWN=\(.thumbs_down // "0")",
      @sh "LESSONS=\(.lessons // "0")",
      @sh "TREND=\(.trend // "?")",
      @sh "CACHE_TS=\(.updated_at // "0")"
    ' 2>/dev/null)"
  fi
fi

# Background refresh from REST API when cache is stale (>120s)
if [ $(( _NOW - ${CACHE_TS:-0} )) -gt 120 ]; then
  (
    _R=$(curl -s --max-time 3 "${LOCAL_API_ORIGIN}/v1/feedback/stats" -H "Authorization: Bearer ${THUMBGATE_API_KEY:-tg_creator_dev_enterprise}" 2>/dev/null)
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

# ── Clickable statusline affordances ─────────────────────────────
LINK_STATE="offline"
UP_URL=""; DOWN_URL=""; DASHBOARD_URL=""; LESSONS_URL=""
DASHBOARD_LABEL="Dashboard"; LESSONS_LABEL="Lessons"
_LINKS_JSON=$(node "${SCRIPT_DIR}/statusline-links.js" 2>/dev/null)
if [ -n "$_LINKS_JSON" ]; then
  eval "$(echo "$_LINKS_JSON" | jq -r '
    @sh "LINK_STATE=\(.state // "offline")",
    @sh "UP_URL=\(.upUrl // "")",
    @sh "DOWN_URL=\(.downUrl // "")",
    @sh "DASHBOARD_URL=\(.dashboardUrl // "")",
    @sh "LESSONS_URL=\(.lessonsUrl // "")",
    @sh "DASHBOARD_LABEL=\(.dashboardLabel // "Dashboard")",
    @sh "LESSONS_LABEL=\(.lessonsLabel // "Lessons")"
  ' 2>/dev/null)"
fi

# ── ThumbGate package metadata ────────────────────────────────────────
TG_VERSION="unknown"; TG_TIER="Free"
_META_JSON=$(node "${SCRIPT_DIR}/statusline-meta.js" 2>/dev/null)
if [ -n "$_META_JSON" ]; then
  eval "$(echo "$_META_JSON" | jq -r '
    @sh "TG_VERSION=\(.version // "unknown")",
    @sh "TG_TIER=\(.tier // "Free")"
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

# ── Latest lesson (data available for extensions; not rendered in statusbar) ──
LESSON_TEXT=""; LESSON_ID=""; LESSON_LABEL=""; LESSON_LINK=""
_LESSON_JSON=$(node "${SCRIPT_DIR}/statusline-lesson.js" 2>/dev/null)
if [ -n "$_LESSON_JSON" ]; then
  eval "$(echo "$_LESSON_JSON" | jq -r '
    @sh "LESSON_TEXT=\(.text // "")",
    @sh "LESSON_ID=\(.lessonId // "")",
    @sh "LESSON_LABEL=\(.label // "")",
    @sh "LESSON_LINK=\(.link // "")"
  ' 2>/dev/null)"
fi

# ── Colors ────────────────────────────────────────────────────────
G='\033[32m'; R='\033[31m'; M='\033[35m'; C='\033[36m'; D='\033[90m'; BD='\033[1m'; RST='\033[0m'

# Trend arrow
case "${TREND}" in
  improving) ARROW="↗" ;; degrading) ARROW="↘" ;; stable) ARROW="→" ;; *) ARROW="?" ;;
esac

# OSC 8 hyperlink: \e]8;;URL\a LABEL \e]8;;\a
# Falls back to plain label when URL is empty or localhost.
osc_link() {
  local url="$1"
  local label="$2"
  # THUMBGATE_STATUSLINE_PLAIN=1 suppresses OSC 8 hyperlinks. Consumers that embed
  # ThumbGate as a non-last row in a multi-line statusline should set this, because
  # some agents (Claude Code) silently drop downstream rows when a preceding row
  # contains OSC 8 sequences.
  if [ "${THUMBGATE_STATUSLINE_PLAIN:-0}" = "1" ]; then
    printf '%s' "$label"
    return 0
  fi
  case "$url" in
    "") printf '%s' "$label" ;;
    *) printf '\033]8;;%s\007%s\033]8;;\007' "$url" "$label" ;;
  esac
  return 0
}

UP_LINK="$(osc_link "$UP_URL" "👍")"
DOWN_LINK="$(osc_link "$DOWN_URL" "👎")"
DASHBOARD_LINK="$(osc_link "$DASHBOARD_URL" "$DASHBOARD_LABEL")"
LESSONS_LINK="$(osc_link "$LESSONS_URL" "$LESSONS_LABEL")"
LATEST_LESSON_LINK=""
if [ -n "$LESSON_LABEL" ]; then
  _DISPLAY_LINK="$LESSON_LINK"
  if [ -n "$LESSON_TEXT" ]; then
    LATEST_LESSON_LINK="$(osc_link "$_DISPLAY_LINK" "${LESSON_LABEL}: ${LESSON_TEXT}")"
  else
    LATEST_LESSON_LINK="$(osc_link "$_DISPLAY_LINK" "$LESSON_LABEL")"
  fi
fi

# ── Output (single line) ─────────────────────────────────────────
LINE="ThumbGate v${TG_VERSION} · ${TG_TIER}"
if [ "$UP" = "0" ] && [ "$DOWN" = "0" ]; then
  LINE="${D}${LINE} · no feedback yet${RST} · ${C}${DASHBOARD_LINK}${RST} · ${M}${LESSONS_LINK}${RST}"
  [ -n "$LATEST_LESSON_LINK" ] && LINE="${LINE} · ${D}${LATEST_LESSON_LINK}${RST}"
  printf '%b\n' "$LINE"
else
  LINE="${LINE} · ${G}${BD}${UP}${RST}${UP_LINK} ${R}${BD}${DOWN}${RST}${DOWN_LINK} ${ARROW}"

  # Control Tower alerts (if any)
  [ "${SLO_V:-0}" -gt 0 ] && LINE="${LINE} ${R}${SLO_V} SLO${RST}"
  [ "${AT_RISK:-0}" -gt 0 ] && LINE="${LINE} ${R}${AT_RISK}⚠${RST}"
  [ "${ANOMALIES:-0}" -gt 0 ] && LINE="${LINE} ${R}${ANOMALIES}☠${RST}"
  LINE="${LINE} · ${C}${DASHBOARD_LINK}${RST} · ${M}${LESSONS_LINK}${RST}"
  [ -n "$LATEST_LESSON_LINK" ] && LINE="${LINE} · ${D}${LATEST_LESSON_LINK}${RST}"

  printf '%b\n' "$LINE"
fi
