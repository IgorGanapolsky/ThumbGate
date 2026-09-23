#!/usr/bin/env bash
# install-thumbgate-daily-publish-launchd.sh — Daily ThumbGate News & Technical Discoveries LaunchAgent.
#
# Default: every day at 09:00 AM EST (local).
#
# Usage:
#   bash scripts/install-thumbgate-daily-publish-launchd.sh
#   bash scripts/install-thumbgate-daily-publish-launchd.sh --uninstall
#
# Logs: ~/Library/Logs/thumbgate-daily-publish.log
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/scripts/thumbgate-daily-discoveries-publish.sh"
LABEL="com.thumbgate.daily-publish"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
LOG_DIR="$HOME/Library/Logs"
HOUR="${THUMBGATE_PUBLISH_HOUR:-9}"
MINUTE="${THUMBGATE_PUBLISH_MINUTE:-0}"

UNINSTALL=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --uninstall) UNINSTALL=1 ;;
    -h|--help)
      echo "Usage: $0 [--uninstall]"
      exit 0
      ;;
    *)
      echo "unknown arg: $1" >&2
      exit 2
      ;;
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

mkdir -p "$LOG_DIR" "$HOME/Library/LaunchAgents"

cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${SCRIPT}</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>${HOUR}</integer>
    <key>Minute</key>
    <integer>${MINUTE}</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/thumbgate-daily-publish.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/thumbgate-daily-publish.log</string>
  <key>WorkingDirectory</key>
  <string>${ROOT}</string>
</dict>
</plist>
PLIST_EOF

launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

echo "installed and loaded ${PLIST} (runs daily at ${HOUR}:${MINUTE})"
