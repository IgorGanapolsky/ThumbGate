#!/usr/bin/env node
'use strict';

// scripts/gates/tokenomics-cost-guard.js
// -----------------------------------------------------------------------------
// PreToolUse gate: enforce prompt and token cost limits for coding agents.
// Tracks cumulative session token usage and stops the agent if it exceeds a 
// user-defined dollar/token budget.
//
// Wire into .claude/settings.json:
//   "hooks": {
//     "PreToolUse": [
//       { "matcher": ".*", "command": "node scripts/gates/tokenomics-cost-guard.js" }
//     ]
//   }
//
// Configured in environment:
//   THUMBGATE_MONTHLY_BUDGET_USD=15.00
// -----------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { addSpend, getBudgetStatus } = require('../budget-guard');

function readToolUse() {
  let raw = '';
  try {
    raw = fs.readFileSync(0, 'utf8');
  } catch (_) {
    return null;
  }
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_) { return null; }
}

function approve(reason) {
  console.log(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: reason },
  }));
  process.exit(0);
}

function block(reason) {
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason: reason,
    },
  }));
  process.exit(0);
}

function main() {
  if (process.env.THUMBGATE_BYPASS_BUDGET === '1') {
    return approve('Bypassed budget controls via env variable.');
  }

  const payload = readToolUse();
  if (!payload) return approve('No hook payload available; pass-through.');

  const toolName = payload.tool_name || payload.toolName || 'unknown';
  const serializedPayload = JSON.stringify(payload);

  // Estimate the input size of this tool call.
  // Standard heuristic: payload character length / 4 is a decent token estimate.
  const inputEstTokens = Math.max(100, Math.round(serializedPayload.length / 4));
  const outputEstTokens = 600; // Average thinking overhead

  // Calculate incremental costs (Sonnet 4.5 baseline: $3/1M input, $15/1M output)
  const inputCost = (inputEstTokens * 3.00) / 1_000_000;
  const outputCost = (outputEstTokens * 15.00) / 1_000_000;
  const incrementalCost = inputCost + outputCost;

  const status = getBudgetStatus();

  if (status.totalUsd + incrementalCost > status.budgetUsd) {
    const reason = `ThumbGate Alert: Estimated tool call cost ($${incrementalCost.toFixed(4)}) would exceed monthly tokenomics budget ($${status.totalUsd.toFixed(2)} + $${incrementalCost.toFixed(4)} > $${status.budgetUsd.toFixed(2)} USD).`;
    return block(reason);
  }

  // Record the spent amount in the ledger
  try {
    addSpend({
      amountUsd: incrementalCost,
      source: `agent-tool:${toolName}`,
      note: `Estimated cost for ${toolName} call of size ${serializedPayload.length} chars`
    });
  } catch (err) {
    // If addSpend fails due to race conditions or budget limit
    return block(`ThumbGate Alert: Budget exceeded. ${err.message}`);
  }

  approve(`Within budget limits ($${(status.totalUsd + incrementalCost).toFixed(4)} / $${status.budgetUsd.toFixed(2)}).`);
}

try {
  main();
} catch (err) {
  console.error('[tokenomics-cost-guard] internal error:', err && err.message);
  approve('Gate internal error; failing open.');
}
