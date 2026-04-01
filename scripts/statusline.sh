#!/bin/bash
# ThumbGate Status Line for Claude Code
# Shows RLHF feedback stats at a glance with clickable links.
# Installed by: npx mcp-memory-gateway init --agent claude-code

# ── Parse Claude Code session JSON from stdin ─────────────────────
eval "$(cat | jq -r '
  def n(f): f // 0;
  @sh "CTX_PCT=\(n(.context_window.used_percentage) | floor)"
' 2>/dev/null)"
CTX_PCT="${CTX_PCT:-0}"

# ── RLHF stats from cache ────────────────────────────────────────
RLHF_CACHE="${RLHF_FEEDBACK_DIR:-.}/.rlhf/statusline_cache.json"
# Fallback: check common locations
if [ ! -f "$RLHF_CACHE" ]; then
  for dir in "." "${HOME}"; do
    [ -f "${dir}/.rlhf/statusline_cache.json" ] && RLHF_CACHE="${dir}/.rlhf/statusline_cache.json" && break
  done
fi

UP="0"; DOWN="0"; LESSONS="0"; TREND="?"
if [ -f "$RLHF_CACHE" ]; then
  eval "$(jq -r '
    @sh "UP=\(.thumbs_up // "0")",
    @sh "DOWN=\(.thumbs_down // "0")",
    @sh "LESSONS=\(.lessons // "0")",
    @sh "TREND=\(.trend // "?")"
  ' "$RLHF_CACHE" 2>/dev/null)"
fi

# ── Colors ────────────────────────────────────────────────────────
G='\033[32m'; R='\033[31m'; M='\033[35m'; D='\033[90m'; BD='\033[1m'; RST='\033[0m'

# Trend arrow
case "${TREND}" in
  improving) ARROW="↗" ;; degrading) ARROW="↘" ;; stable) ARROW="→" ;; *) ARROW="?" ;;
esac

# ── OSC 8 clickable links ────────────────────────────────────────
osc_link() { printf '\033]8;;%s\a%s\033]8;;\a' "$1" "$2"; }
DASH="http://localhost:9876"

# ── Output (single line) ─────────────────────────────────────────
if [ "$UP" = "0" ] && [ "$DOWN" = "0" ]; then
  LABEL=$(osc_link "${DASH}/dashboard" "ThumbGate: no feedback yet")
  echo -e "${D}${LABEL}${RST}"
else
  TG_LINK=$(osc_link "${DASH}/dashboard" "ThumbGate")
  UP_LINK=$(osc_link "${DASH}/feedback/quick?signal=up" "${G}${BD}${UP}${RST}👍")
  DOWN_LINK=$(osc_link "${DASH}/feedback/quick?signal=down" "${R}${BD}${DOWN}${RST}👎")
  LESSONS_LINK=$(osc_link "${DASH}/lessons" "${M}${BD}${LESSONS}${RST} lessons")
  echo -e "${TG_LINK}: ${UP_LINK} ${DOWN_LINK} · ${LESSONS_LINK} ${ARROW}"
fi
