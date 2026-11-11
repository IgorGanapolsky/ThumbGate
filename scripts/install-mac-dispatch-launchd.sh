#!/usr/bin/env bash
# install-mac-dispatch-launchd.sh — run the cloud-to-Mac dispatch loop every few minutes.
#
# Polls open `ready-for-agent` issues and runs `claude -p` on them under YOUR Claude Code
# permission settings. This installer never changes those settings.
#
# Usage:
#   bash scripts/install-mac-dispatch-launchd.sh               # every 300s
#   MAC_DISPATCH_INTERVAL=120 bash scripts/install-mac-dispatch-launchd.sh
#   bash scripts/install-mac-dispatch-launchd.sh --uninstall
#
# Logs: ~/Library/Logs/thumbgate-mac-dispatch.log
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/scripts/mac-dispatch-loop.js"
LABEL="com.thumbgate.mac-dispatch"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
LOG="$HOME/Library/Logs/thumbgate-mac-dispatch.log"
INTERVAL="${MAC_DISPATCH_INTERVAL:-300}"

UNINSTALL=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --uninstall) UNINSTALL=1 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
  shift
done

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "error: macOS only" >&2
  exit 1
fi

if [[ "$UNINSTALL" -eq 1 ]]; then
  launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
  rm -f "$PLIST"
  echo "removed $PLIST"
  exit 0
fi

NODE_BIN="$(command -v node || true)"
for bin in node gh claude; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "error: '$bin' is not on PATH; install it first" >&2
    exit 1
  fi
done
gh auth status >/dev/null 2>&1 || { echo "error: run 'gh auth login' first" >&2; exit 1; }

# launchd starts jobs with a bare PATH, so record where node, gh and claude live now.
JOB_PATH="$(dirname "$(command -v claude)"):$(dirname "$(command -v gh)"):$(dirname "$NODE_BIN"):/usr/bin:/bin:/usr/sbin:/sbin"

xml_escape() { sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }
env_entry() {
  local key="$1" value="${!1:-}"
  [[ -n "$value" ]] || return 0
  printf '    <key>%s</key>\n    <string>%s</string>\n' "$key" "$(printf '%s' "$value" | xml_escape)"
}

mkdir -p "$(dirname "$LOG")" "$HOME/Library/LaunchAgents"

cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>${SCRIPT}</string>
    <string>--once</string>
  </array>
  <key>StartInterval</key>
  <integer>${INTERVAL}</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$(printf '%s' "$JOB_PATH" | xml_escape)</string>
    <key>HOME</key>
    <string>$(printf '%s' "$HOME" | xml_escape)</string>
$(env_entry MAC_DISPATCH_REPO)$(env_entry MAC_DISPATCH_ALLOWED_AUTHORS)$(env_entry MAC_DISPATCH_DEFAULT_WORKDIR)$(env_entry MAC_DISPATCH_WORKDIR_ROOTS)$(env_entry MAC_DISPATCH_MACHINE_ID)$(env_entry MAC_DISPATCH_TIMEOUT_MINUTES)$(env_entry MAC_DISPATCH_CLAUDE_ARGS)
  </dict>
  <key>StandardOutPath</key>
  <string>${LOG}</string>
  <key>StandardErrorPath</key>
  <string>${LOG}</string>
  <key>WorkingDirectory</key>
  <string>${ROOT}</string>
</dict>
</plist>
PLIST_EOF

plutil -lint "$PLIST" >/dev/null
launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "installed $PLIST (every ${INTERVAL}s). Logs: $LOG"
echo "check it: launchctl print gui/$(id -u)/${LABEL} | head -20"
