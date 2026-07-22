#!/usr/bin/env bash
# Hook: Stop
#
# When it fires: After Claude finishes responding (every turn).
# What it does:  Blocks "deployed/live/shipped/in production" claims unless the
#                same response contains evidence (curl /health output, a
#                buildSha string, an HTTP 200 from the production host, the
#                expected version literal, or the verify-deploy-comment workflow
#                green sentinel).
# Why:           CLAUDE.md hard-block rule #6: "saying 'deployed' or 'live'
#                without curl output." This hook used to only print a warning;
#                the warning was repeatedly ignored. It now hard-blocks the turn
#                with a `decision: block` JSON output, the same contract as
#                hook-stop-pr-thread-check.sh.
#
# Env vars:
#   CLAUDE_RESPONSE     — the assistant's last response text
#   CLAUDE_STOP_REASON  — why the agent stopped (set by Claude Code)
#
# Marker file (informational, NOT a substitute for in-response evidence):
#   ${TMPDIR:-/tmp}/.thumbgate-last-deploy-verify — written by
#   scripts/hook-pre-tool-use.js when an out-of-band verify is observed.
#
# Exit code:
#   0 in every path. The block decision is emitted via JSON on stdout.

set -euo pipefail

PROD_URL="thumbgate-production.up.railway.app"
PROD_DOMAIN="thumbgate.ai"
VERIFICATION_MARKER="${TMPDIR:-/tmp}/.thumbgate-last-deploy-verify"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
EXPECTED_VERSION="$(node -e "console.log(require(process.argv[1]).version)" "${REPO_ROOT}/package.json" 2>/dev/null || echo "")"

export PROD_URL PROD_DOMAIN EXPECTED_VERSION

node -e '
  "use strict";

  const fs = require("fs");

  let stopHookActive = false;
  let stdinResponse = "";
  try {
    const raw = fs.readFileSync(0, "utf8");
    const payload = raw ? JSON.parse(raw) : {};
    stopHookActive = payload.stop_hook_active === true;
    if (typeof payload.last_assistant_message === "string") {
      stdinResponse = payload.last_assistant_message;
    }
  } catch {
    // no stdin payload available - env-only invocation (tests, manual runs)
  }

  // Claude Code re-invokes Stop hooks with stop_hook_active=true to give the
  // agent one retry after a block. Blocking again on that retry (instead of
  // yielding) makes Claude Code hard-override the hook after
  // CLAUDE_CODE_STOP_HOOK_BLOCK_CAP consecutive blocks (default 2) and print
  // a warning - so this hook must succeed on retry, not re-litigate the same
  // response. See https://docs.claude.com/en/docs/claude-code/hooks re
  // Stop/SubagentStop stop_hook_active handling.
  if (stopHookActive) {
    process.exit(0);
  }

  const response = process.env.CLAUDE_RESPONSE || stdinResponse;

  if (!response) {
    process.exit(0);
  }

  const prodUrl = process.env.PROD_URL || "";
  const prodDomain = process.env.PROD_DOMAIN || "";
  const expectedVersion = process.env.EXPECTED_VERSION || "";

  const claimSignal = new RegExp(
    "\\b(deployed|shipped|live (in|to) production|live at|now live|" +
    "is live\\b|in prod\\b|in production\\b|production[- ]ready|" +
    "ready (for|to) ship|verified in (prod|production))\\b",
    "i"
  ).test(response);

  if (!claimSignal) {
    process.exit(0);
  }

  // A response can mention a claim word while explicitly denying it
  // happened - "deployed, no", "not deployed yet", "has not shipped".
  // Only treat this as a real claim if at least one match is NOT adjacent
  // to a negation. The window is intentionally tight (a handful of words
  // immediately before/after the match, not the whole response) so an
  // unrelated no/not elsewhere cannot suppress a genuine claim - that
  // would trade a false positive for the more dangerous false negative.
  // Deliberately no contraction forms (isnt, hasnt, ...) in NEGATION_BEFORE:
  // spelling those needs an apostrophe character, and this whole node -e
  // block is one bash single-quoted string where a literal apostrophe
  // terminates the string early and corrupts the script - hit that exact
  // bug while first writing this check. "not"/"never" alone plus the 0-2
  // word gap below already cover "is not deployed", "has not been
  // deployed", etc., since the gap absorbs "is"/"has been"/etc.
  const CLAIM_PATTERN_GLOBAL = /\b(deployed|shipped|live (in|to) production|live at|now live|is live\b|in prod\b|in production\b|production[- ]ready|ready (for|to) ship|verified in (prod|production))\b/gi;
  const NEGATION_BEFORE = /\b(not|never)\b(?:\s+\S+){0,2}\s*$/i;
  const NEGATION_AFTER = /^[\s,.:;?]*\b(no|not)\b/i;
  const FOREIGN_SYSTEM_PATTERN = /\b(mac-yolo-safeguards|tinker-yolo|hermes|hermes-mobile|ollama|mac mini|mac pro|answerguard)\b/i;
  const THUMBGATE_PATTERN = /\bthumbgate\b|thumbgate-production\.up\.railway\.app|thumbgate\.ai/i;

  function claimClause(index, length) {
    let start = index;
    let end = index + length;
    const isBoundary = (character) => /[.!?;\n]/.test(character);
    while (start > 0 && !isBoundary(response[start - 1])) start -= 1;
    while (end < response.length && !isBoundary(response[end])) end += 1;
    return response.slice(start, end);
  }

  let hasRelevantUnnegatedClaim = false;
  let claimMatch;
  while ((claimMatch = CLAIM_PATTERN_GLOBAL.exec(response)) !== null) {
    const before = response.slice(Math.max(0, claimMatch.index - 30), claimMatch.index);
    const after = response.slice(claimMatch.index + claimMatch[0].length, claimMatch.index + claimMatch[0].length + 15);
    const clause = claimClause(claimMatch.index, claimMatch[0].length);
    const isForeignOnlyClaim = FOREIGN_SYSTEM_PATTERN.test(clause) && !THUMBGATE_PATTERN.test(clause);
    if (!NEGATION_BEFORE.test(before) && !NEGATION_AFTER.test(after) && !isForeignOnlyClaim) {
      hasRelevantUnnegatedClaim = true;
      break;
    }
  }

  if (!hasRelevantUnnegatedClaim) {
    process.exit(0);
  }

  const hostPattern = new RegExp(
    prodUrl.replace(/\./g, "\\.") + "|" + prodDomain.replace(/\./g, "\\."),
    "i"
  );

  const hasCurlEvidence = /curl\s+(?:-\S+\s+)*https?:\/\/(?:thumbgate-production\.up\.railway\.app|thumbgate\.ai)/i.test(response);
  const hasBuildSha = /"buildSha"\s*:\s*"[a-f0-9]{6,}"/i.test(response) || /buildSha\s*[:=]\s*[a-f0-9]{6,}/i.test(response);
  const hasVersionString = /"version"\s*:\s*"[0-9]+\.[0-9]+\.[0-9]+"/i.test(response);
  const hasExpectedVersion = expectedVersion && new RegExp(expectedVersion.replace(/\./g, "\\.")).test(response);
  const hasHttp200OnProd = /\bHTTP[\s/]*200\b/i.test(response) && hostPattern.test(response);
  const hasHealthRef = /\/health\b/.test(response) && hostPattern.test(response);
  const hasWorkflowSentinel = /Deploy verified/i.test(response);

  const evidence =
    hasCurlEvidence ||
    hasBuildSha ||
    hasVersionString ||
    hasExpectedVersion ||
    hasHttp200OnProd ||
    hasHealthRef ||
    hasWorkflowSentinel;

  if (evidence) {
    process.exit(0);
  }

  const output = {
    decision: "block",
    reason: "MANDATORY (CLAUDE.md hard-block rule #6): never say \"deployed\"/\"live\"/\"shipped\" without showing curl output, a /health JSON snapshot, a buildSha, an HTTP 200 from the production host, or the \"Deploy verified\" workflow sentinel. Re-run the deployment-verification gate and include the evidence in the same response."
  };
  process.stdout.write(JSON.stringify(output));
' 2>/dev/null

exit 0
