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
# A legacy `.thumbgate-last-deploy-verify` marker may still be written by
# older runtimes. This hook deliberately ignores it: marker text on stdout
# violates the Stop-hook JSON contract, and out-of-band state is not a
# substitute for evidence in the assistant response.
#
# Exit code:
#   0 in every path. The block decision is emitted via JSON on stdout.

set -euo pipefail

PROD_URL="thumbgate-production.up.railway.app"
PROD_DOMAIN="thumbgate.ai"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
EXPECTED_VERSION="$(node -e "console.log(require(process.argv[1]).version)" "${REPO_ROOT}/package.json" 2>/dev/null || echo "")"

export PROD_URL PROD_DOMAIN EXPECTED_VERSION

node -e '
  "use strict";

  const fs = require("fs");

  let response = process.env.CLAUDE_RESPONSE || "";
  if (!response) {
    try {
      const raw = fs.readFileSync(0, "utf8");
      const payload = raw ? JSON.parse(raw) : {};
      response = typeof payload.last_assistant_message === "string"
        ? payload.last_assistant_message
        : "";
    } catch {
      response = "";
    }
  }

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

  // A bare "deployed"/"shipped" is ambiguous - e.g. "no model was deployed"
  // (a local Ollama model) or "the PR merged" (a sibling repo) have nothing
  // to do with ThumbGate production. But REQUIRING ThumbGate/production
  // wording to enable the check (the previous approach) fails open on real
  // claims phrased without those words, e.g. "the federal route is now
  // live" - so default stays strict; only skip when the response contains
  // a positive signal that this is about a DIFFERENT, named system. This is
  // an exclusion list of exactly the false positives already hit, not an
  // inclusion list that a genuine ThumbGate claim could fail to match.
  const foreignSystemSignal = new RegExp(
    "\\bmac-yolo-safeguards\\b|\\btinker-yolo\\b|\\bhermes\\b|\\bhermes-mobile\\b|" +
    "\\bollama\\b|\\bmac mini\\b|\\bmac pro\\b|\\banswerguard\\b",
    "i"
  ).test(response);

  if (foreignSystemSignal) {
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
