#!/usr/bin/env bash
# Runs on every prompt Cursor submits. A typed thumbs-down or thumbs-up becomes feedback, and two thumbs-downs from a
# person on one command become a gate (the same path Claude Code uses). Always lets the prompt through.
# THUMBGATE_CLI overrides the command for tests.

set -uo pipefail

INPUT=$(cat)
if [ -n "${THUMBGATE_CLI:-}" ]; then
  echo "$INPUT" | ${THUMBGATE_CLI} cursor-prompt 2>/dev/null
else
  echo "$INPUT" | npx --yes --package thumbgate@latest thumbgate cursor-prompt 2>/dev/null
fi
exit 0
