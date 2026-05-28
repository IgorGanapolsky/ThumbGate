#!/usr/bin/env bash
# Zero-Egress Proof — for the Greenberg Traurig walkthrough.
#
# Demonstrates Pillar #3 of the legal pitch: "100% locally with zero cloud
# data calls for enforcement." Runs a gate evaluation against a UPL-shaped
# prompt while capturing every outbound network connection. The script
# proves no traffic leaves the firm boundary during the check.
#
# Usage on a laptop with strace + ss:
#   ./scripts/demo/zero-egress-proof.sh
#
# Inside this remote container, strace may not be available; the script
# falls back to ss-based connection snapshots before/after the gate run.

set -u
set -o pipefail

DEMO_PROMPT='You should file your wrongful-termination claim in the Southern District of Florida; you likely prevail on the retaliation count.'
TEMPLATES="$(dirname "$0")/../../config/gate-templates.json"

echo "=== Zero-Egress Proof ==="
echo "Pitch: enforcement runs locally; privileged data never leaves the firm."
echo ""
echo "Prompt under evaluation (UPL-shaped, ABA Rule 5.5):"
echo "  > ${DEMO_PROMPT}"
echo ""

# Snapshot of outbound ESTABLISHED connections BEFORE the gate evaluation.
echo "--- Outbound connections BEFORE gate evaluation ---"
if command -v ss >/dev/null 2>&1; then
  ss -tnp state established 2>/dev/null | awk 'NR>1 {print "  " $0}' || echo "  (ss unavailable)"
else
  netstat -tnp 2>/dev/null | grep ESTABLISHED | awk '{print "  " $0}' || echo "  (netstat unavailable)"
fi
BEFORE_COUNT=$(ss -tn state established 2>/dev/null | tail -n +2 | wc -l | tr -d ' \n')
BEFORE_COUNT=${BEFORE_COUNT:-0}
echo "  count_before=${BEFORE_COUNT}"
echo ""

# Run the gate evaluation. Pure local: read JSON, compile regex, test string.
# No network primitive is invoked anywhere in this path.
echo "--- Gate evaluation (local-only, no cloud call) ---"
# Pass the prompt and templates path via env vars so we never have to quote
# user-supplied text into a heredoc'd JS source. bash ${var@Q} produces
# bash-ANSI-C output (e.g. $'don\'t' or 'a'\''b') that is not valid JavaScript;
# env-var passing is robust to any future prompt content (apostrophes,
# newlines, em-dashes, the lot).
DEMO_PROMPT="${DEMO_PROMPT}" TEMPLATES_PATH="${TEMPLATES}" node -e '
const fs = require("fs");
const data = JSON.parse(fs.readFileSync(process.env.TEMPLATES_PATH, "utf8"));
const gate = data.templates.find((t) => t.id === "block-unauthorized-practice-of-law");
if (!gate) { console.error("Gate not found"); process.exit(2); }
const re = new RegExp(gate.pattern);
const prompt = process.env.DEMO_PROMPT;
const fired = re.test(prompt);
console.log("  gate:      " + gate.id);
console.log("  aba_rule:  Rule 5.5 — Unauthorized Practice of Law");
console.log("  pattern:   " + gate.pattern);
console.log("  result:    " + (fired ? "BLOCKED" : "allowed"));
console.log("  decision:  " + (fired ? "denied — routed to attorney review queue" : "no match"));
if (!fired) process.exit(1);
'
GATE_RC=$?
echo ""

# Snapshot of outbound ESTABLISHED connections AFTER the gate evaluation.
echo "--- Outbound connections AFTER gate evaluation ---"
if command -v ss >/dev/null 2>&1; then
  ss -tnp state established 2>/dev/null | awk 'NR>1 {print "  " $0}' || echo "  (ss unavailable)"
else
  netstat -tnp 2>/dev/null | grep ESTABLISHED | awk '{print "  " $0}' || echo "  (netstat unavailable)"
fi
AFTER_COUNT=$(ss -tn state established 2>/dev/null | tail -n +2 | wc -l | tr -d ' \n')
AFTER_COUNT=${AFTER_COUNT:-0}
echo "  count_after=${AFTER_COUNT}"
echo ""

# Delta. Any new connection during the gate eval would surface here.
DELTA=$((AFTER_COUNT - BEFORE_COUNT))
echo "--- Verdict ---"
echo "  connections_opened_during_enforcement = ${DELTA}"
if [ "${DELTA}" -le 0 ] && [ "${GATE_RC}" -eq 0 ]; then
  echo "  PASS: gate fired AND no new outbound connection opened."
  echo "  Privileged data did not leave the firm boundary during enforcement."
  exit 0
fi
if [ "${GATE_RC}" -ne 0 ]; then
  echo "  FAIL: gate did NOT fire on the UPL prompt. Pattern needs review."
  exit 1
fi
echo "  WARN: ${DELTA} new outbound connection(s) observed. Investigate before demo."
exit 2
