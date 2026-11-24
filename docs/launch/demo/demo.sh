#!/usr/bin/env bash
# Scripted terminal session for the ThumbGate launch video. Runs the real CLI in a throwaway
# HOME, project and feedback folder under docs/launch/.demo-sandbox/<run>. Run via record.sh.
set -u
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
RUN="$ROOT/docs/launch/.demo-sandbox/run-$(date +%s)"
mkdir -p "$RUN/home" "$RUN/proj"
export HOME="$RUN/home" THUMBGATE_FEEDBACK_DIR="$RUN/fb" THUMBGATE_NO_TELEMETRY=1
unset THUMBGATE_STRICT_ENFORCEMENT THUMBGATE_GOVERNANCE_MODE
cd "$RUN/proj" && git init -q .
CLI="node $ROOT/bin/cli.js"
PAYLOAD="$ROOT/docs/launch/demo/payload.json"
FMT="node $ROOT/docs/launch/demo/fmt.js"

type_cmd() { printf '\033[1;32m$\033[0m '; for ((i = 0; i < ${#1}; i++)); do printf '%s' "${1:i:1}"; sleep 0.025; done; printf '\n'; }
label() { printf '\n\033[1;36m# %s\033[0m\n' "$1"; sleep "${2:-2}"; }

clear
label "ThumbGate: real run, throwaway folder, default settings" 2.5
label "1. The agent runs a download-and-run command (default: warns)" 1.5
type_cmd "thumbgate gate-check < tool-call.json"
$CLI gate-check < "$PAYLOAD" 2>/dev/null | $FMT
sleep 5
label "2. You give it a thumbs-down" 1.5
type_cmd 'thumbgate capture --feedback=down --context="piped a downloaded script into the shell"'
$CLI capture --feedback=down --context="agent piped a downloaded script straight into the shell" --what-went-wrong="unreviewed remote script ran" --what-to-change="download, read, then run" --tags=shell --json 2>/dev/null | awk '/^{/,/^}/' | $FMT
sleep 3.5
label "3. Same action again: the warning now carries your lesson (still warns)" 1.5
type_cmd "thumbgate gate-check < tool-call.json"
$CLI gate-check < "$PAYLOAD" 2>/dev/null | $FMT
sleep 7
label "4. Strict enforcement ON: the same action is now blocked" 1.5
type_cmd "THUMBGATE_STRICT_ENFORCEMENT=1 thumbgate gate-check < tool-call.json"
THUMBGATE_STRICT_ENFORCEMENT=1 $CLI gate-check < "$PAYLOAD" 2>/dev/null | $FMT
sleep 5
label "Warns by default. Strict mode blocks. Your thumbs-down is shown back next time." 3.5
