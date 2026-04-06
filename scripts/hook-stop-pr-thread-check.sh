#!/bin/bash
# Stop hook — blocks "done/pushed/resolved" claims without PR thread evidence
# Inspects the assistant response for completion signals and requires proof
# that all PR review threads are resolved before allowing the claim.
#
# Environment variables (Stop hooks):
#   CLAUDE_RESPONSE — the assistant's last response text
#
# Returns JSON with decision: "block" + message, or passes through silently.

set -euo pipefail

RESPONSE="${CLAUDE_RESPONSE:-}"

# If no response, nothing to check
if [ -z "$RESPONSE" ]; then
  exit 0
fi

node -e '
  "use strict";

  const response = process.env.CLAUDE_RESPONSE || "";

  // 1. Detect completion/done signals
  const doneSignal = /\b(done|pushed|resolved|ready for review|all comments addressed|merged|ship it|completed|fixed and pushed)\b/i.test(response);
  if (!doneSignal) {
    // No completion claim — pass through silently
    process.exit(0);
  }

  // 2. Check for PR thread evidence in the response
  const threadEvidence =
    /\b(0 unresolved|all threads resolved|no open threads|no unresolved|all comments resolved)\b/i.test(response) ||
    /gh pr view.*review/i.test(response) ||
    /reviewDecision.*APPROVED/i.test(response) ||
    /comments.*:\s*0\b/i.test(response) ||
    /unresolved.*:\s*0\b/i.test(response);

  if (threadEvidence) {
    // Evidence present — allow
    process.exit(0);
  }

  // 3. Check if we are actually in a PR context (has a branch that is not main/master)
  const { execSync } = require("child_process");
  let branch = "";
  try {
    branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf-8" }).trim();
  } catch {
    // Not in a git repo — skip check
    process.exit(0);
  }

  if (branch === "main" || branch === "master") {
    // Not on a feature branch — no PR to check
    process.exit(0);
  }

  // 4. Block: completion claim on a feature branch without thread evidence
  const output = {
    decision: "block",
    reason: "MANDATORY: Before declaring done, run `gh pr view --json reviewDecision,comments` and confirm 0 unresolved threads. Show the output in your response."
  };
  process.stdout.write(JSON.stringify(output));
' 2>/dev/null || true

exit 0
