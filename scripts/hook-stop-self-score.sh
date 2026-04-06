#!/bin/bash
# Claude Code / Amp Stop hook — autonomous self-scoring after every agent turn
# Fires after the agent completes a response. Runs selfAuditAndLog to produce
# a RLAIF self-score entry in self-score-log.jsonl.
#
# Environment variables available in Stop hooks:
#   CLAUDE_STOP_REASON   — why the agent stopped (e.g., "end_turn", "tool_use")
#   CLAUDE_TOOL_OUTPUT   — last tool output (if any)
#
# This hook is NON-BLOCKING — it exits 0 regardless of errors.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
THUMBGATE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Run the self-score via Node.js — sync, no API calls, ~5ms
node -e '
  "use strict";
  const path = require("path");

  // Resolve modules relative to ThumbGate package root
  const rlhfRoot = process.env.THUMBGATE_ROOT;
  const { selfAuditAndLog } = require(path.join(rlhfRoot, "scripts", "rlaif-self-audit"));
  const { getFeedbackPaths } = require(path.join(rlhfRoot, "scripts", "feedback-loop"));

  const stopReason = process.env.CLAUDE_STOP_REASON || "unknown";

  // Build a minimal feedback event for self-scoring
  const feedbackEvent = {
    id: `stop_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    signal: "positive",
    context: `Agent turn completed (stop_reason: ${stopReason}). Autonomous self-score checkpoint.`,
    tags: ["stop-hook", "auto-score"],
    whatWorked: null,
    whatWentWrong: null,
    whatToChange: null,
    rubric: null,
  };

  const paths = getFeedbackPaths();
  const result = selfAuditAndLog(feedbackEvent, paths);

  // Output minimal JSON for hook response (non-blocking)
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "Stop",
      additionalContext: `Self-score: ${result.score} (${result.constraints.filter(c => c.passed).length}/${result.constraints.length} constraints passed)`
    }
  }));
' 2>/dev/null || true

exit 0
