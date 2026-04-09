#!/bin/bash
# ThumbGate Status Line for Claude Code
# Shows ThumbGate feedback stats + package version/tier at a glance.
# Installed by: npx thumbgate init --agent claude-code

# Resolve script directory safely (CodeQL: no uncontrolled paths)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
case "$SCRIPT_DIR" in *[!a-zA-Z0-9/_.-]*) echo "ThumbGate: invalid script path"; exit 1;; esac
LOCAL_API_ORIGIN="${THUMBGATE_LOCAL_API_ORIGIN:-http://localhost:3456}"

# ── Parse Claude Code session JSON from stdin ─────────────────────
eval "$(cat | jq -r '
  def n(f): f // 0;
  @sh "CTX_PCT=\(n(.context_window.used_percentage) | floor)"
' 2>/dev/null)"
CTX_PCT="${CTX_PCT:-0}"

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

# ── Latest lesson ──────────────────────────────────────────────────
LESSON_TEXT=""; LESSON_ID=""
_LESSON_JSON=$(node "${SCRIPT_DIR}/statusline-lesson.js" 2>/dev/null)
if [ -n "$_LESSON_JSON" ]; then
  eval "$(echo "$_LESSON_JSON" | jq -r '
    @sh "LESSON_TEXT=\(.text // "")",
    @sh "LESSON_ID=\(.lessonId // "")"
  ' 2>/dev/null)"
fi

# ── Colors ────────────────────────────────────────────────────────
G='\033[32m'; R='\033[31m'; M='\033[35m'; C='\033[36m'; D='\033[90m'; BD='\033[1m'; RST='\033[0m'

# Trend arrow
case "${TREND}" in
  improving) ARROW="↗" ;; degrading) ARROW="↘" ;; stable) ARROW="→" ;; *) ARROW="?" ;;
esac

osc8_link() {
  local url="$1"
  local label="$2"
  if [ -n "$url" ]; then
    printf '\033]8;;%s\a%s\033]8;;\a' "$url" "$label"
  else
    printf '%s' "$label"
  fi
}

UP_ICON="$(osc8_link "$UP_URL" "👍")"
DOWN_ICON="$(osc8_link "$DOWN_URL" "👎")"
DASHBOARD_LINK="$(osc8_link "$DASHBOARD_URL" "$DASHBOARD_LABEL")"
LESSONS_LINK="$(osc8_link "$LESSONS_URL" "$LESSONS_LABEL")"

is_numeric() {
  case "$1" in
    ''|*[!0-9]*) return 1 ;;
    *) return 0 ;;
  esac
}

# Keep ThumbGate within a conservative left-side budget so Claude's own
# right-side notices do not visually collide with our line.
STATUSLINE_DEFAULT_MAX_CHARS="${THUMBGATE_STATUSLINE_DEFAULT_MAX_CHARS:-96}"
STATUSLINE_RIGHT_RESERVE="${THUMBGATE_STATUSLINE_RIGHT_RESERVE:-28}"
if ! is_numeric "$STATUSLINE_DEFAULT_MAX_CHARS"; then STATUSLINE_DEFAULT_MAX_CHARS=96; fi
if ! is_numeric "$STATUSLINE_RIGHT_RESERVE"; then STATUSLINE_RIGHT_RESERVE=28; fi

if is_numeric "${THUMBGATE_STATUSLINE_MAX_CHARS:-}"; then
  STATUSLINE_MAX_CHARS="$THUMBGATE_STATUSLINE_MAX_CHARS"
else
  STATUSLINE_MAX_CHARS="$STATUSLINE_DEFAULT_MAX_CHARS"
  if is_numeric "${COLUMNS:-}"; then
    _AVAILABLE_CHARS=$(( COLUMNS - STATUSLINE_RIGHT_RESERVE ))
    if [ "$_AVAILABLE_CHARS" -gt 0 ] && [ "$_AVAILABLE_CHARS" -lt "$STATUSLINE_MAX_CHARS" ]; then
      STATUSLINE_MAX_CHARS="$_AVAILABLE_CHARS"
    fi
  fi
fi
if [ "$STATUSLINE_MAX_CHARS" -lt 48 ]; then STATUSLINE_MAX_CHARS=48; fi

PLAIN_SEGMENTS=()
RENDERED_SEGMENTS=()

current_plain_length() {
  local total=0
  local i
  for ((i = 0; i < ${#PLAIN_SEGMENTS[@]}; i++)); do
    if [ "$i" -gt 0 ]; then
      total=$((total + 3))
    fi
    total=$((total + ${#PLAIN_SEGMENTS[$i]}))
  done
  printf '%s' "$total"
}

push_segment() {
  PLAIN_SEGMENTS+=("$1")
  RENDERED_SEGMENTS+=("$2")
}

add_segment_if_fit() {
  local plain="$1"
  local rendered="$2"
  local current extra
  current=$(current_plain_length)
  extra=${#plain}
  if [ "${#PLAIN_SEGMENTS[@]}" -gt 0 ]; then
    extra=$((extra + 3))
  fi
  if [ $((current + extra)) -le "$STATUSLINE_MAX_CHARS" ]; then
    push_segment "$plain" "$rendered"
    return 0
  fi
  return 1
}

truncate_plain_text() {
  local text="$1"
  local max_chars="$2"
  if [ "$max_chars" -le 0 ]; then
    printf ''
  elif [ "${#text}" -le "$max_chars" ]; then
    printf '%s' "$text"
  elif [ "$max_chars" -le 3 ]; then
    printf '%.*s' "$max_chars" "$text"
  else
    printf '%s...' "${text:0:$((max_chars - 3))}"
  fi
}

add_truncated_segment_if_fit() {
  local plain="$1"
  local color="$2"
  local min_chars="${3:-14}"
  local current sep remaining truncated
  current=$(current_plain_length)
  sep=0
  if [ "${#PLAIN_SEGMENTS[@]}" -gt 0 ]; then
    sep=3
  fi
  remaining=$((STATUSLINE_MAX_CHARS - current - sep))
  if [ "$remaining" -lt "$min_chars" ]; then
    return 1
  fi
  truncated=$(truncate_plain_text "$plain" "$remaining")
  push_segment "$truncated" "${color}${truncated}${RST}"
  return 0
}

render_segments() {
  local line=''
  local i
  for ((i = 0; i < ${#RENDERED_SEGMENTS[@]}; i++)); do
    if [ "$i" -gt 0 ]; then
      line="${line} · "
    fi
    line="${line}${RENDERED_SEGMENTS[$i]}"
  done
  printf '%b\n' "$line"
}

# ── Output (single line) ─────────────────────────────────────────
if [ "$UP" = "0" ] && [ "$DOWN" = "0" ]; then
  push_segment "ThumbGate v${TG_VERSION}" "${D}ThumbGate v${TG_VERSION}${RST}"
  push_segment "${TG_TIER}" "${D}${TG_TIER}${RST}"
  push_segment "no feedback yet" "${D}no feedback yet${RST}"
  add_segment_if_fit "${DASHBOARD_LABEL}" "${C}${DASHBOARD_LINK}${RST}"
  add_segment_if_fit "${LESSONS_LABEL}" "${M}${LESSONS_LINK}${RST}"
  render_segments
else
  STATS_PLAIN="${UP}👍 ${DOWN}👎 ${ARROW}"
  STATS_RENDERED="${G}${BD}${UP}${RST}${UP_ICON} ${R}${BD}${DOWN}${RST}${DOWN_ICON} ${ARROW}"
  ALERTS_PLAIN=''
  ALERTS_RENDERED=''

  if [ "${SLO_V:-0}" -gt 0 ]; then
    ALERTS_PLAIN="${ALERTS_PLAIN}${ALERTS_PLAIN:+ }${SLO_V} SLO"
    ALERTS_RENDERED="${ALERTS_RENDERED}${ALERTS_RENDERED:+ }${R}${SLO_V} SLO${RST}"
  fi
  if [ "${AT_RISK:-0}" -gt 0 ]; then
    ALERTS_PLAIN="${ALERTS_PLAIN}${ALERTS_PLAIN:+ }${AT_RISK}⚠"
    ALERTS_RENDERED="${ALERTS_RENDERED}${ALERTS_RENDERED:+ }${R}${AT_RISK}⚠${RST}"
  fi
  if [ "${ANOMALIES:-0}" -gt 0 ]; then
    ALERTS_PLAIN="${ALERTS_PLAIN}${ALERTS_PLAIN:+ }${ANOMALIES}☠"
    ALERTS_RENDERED="${ALERTS_RENDERED}${ALERTS_RENDERED:+ }${R}${ANOMALIES}☠${RST}"
  fi

  push_segment "ThumbGate v${TG_VERSION}" "ThumbGate v${TG_VERSION}"
  push_segment "${TG_TIER}" "${TG_TIER}"
  push_segment "${STATS_PLAIN}" "${STATS_RENDERED}"
  add_segment_if_fit "${DASHBOARD_LABEL}" "${C}${DASHBOARD_LINK}${RST}"
  add_segment_if_fit "${LESSONS_LABEL}" "${M}${LESSONS_LINK}${RST}"
  if [ "${LESSONS:-0}" -gt 0 ]; then
    add_segment_if_fit "${LESSONS} lessons" "${M}${BD}${LESSONS}${RST} lessons"
  fi
  if [ -n "${ALERTS_PLAIN}" ]; then
    add_segment_if_fit "${ALERTS_PLAIN}" "${ALERTS_RENDERED}"
  fi
  if [ -n "${LESSON_TEXT}" ]; then
    add_truncated_segment_if_fit "${LESSON_TEXT}" "${D}" 14
  fi

  render_segments
fi
