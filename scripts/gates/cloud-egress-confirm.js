#!/usr/bin/env node
'use strict';

// scripts/gates/cloud-egress-confirm.js
// -----------------------------------------------------------------------------
// PreToolUse gate: require explicit operator approval before a coding agent
// sends file content / repo data out to the cloud. Mirrors the "permission
// before cloud egress" pattern Perplexity demoed at Computex 2026 with its
// hybrid local-cloud inference orchestrator, applied to coding agents.
//
// Wire into .claude/settings.json:
//   "hooks": {
//     "PreToolUse": [
//       { "matcher": "WebFetch",          "command": "node scripts/gates/cloud-egress-confirm.js" },
//       { "matcher": "mcp__.*__upload.*", "command": "node scripts/gates/cloud-egress-confirm.js" },
//       { "matcher": "Bash(curl*|wget*)", "command": "node scripts/gates/cloud-egress-confirm.js" }
//     ]
//   }
//
// Decision policy:
//   - If the tool is a known cloud-egress surface AND the payload references
//     a repo-local file path, return decision=block with a permission prompt.
//   - If the operator has pre-approved via env (THUMBGATE_CLOUD_EGRESS_OK=1)
//     or via an explicit prevention rule, allow.
//   - Logs every decision to .thumbgate/cloud-egress.jsonl for audit.
// -----------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');

const REPO_ROOT = process.env.THUMBGATE_PROJECT_DIR || process.cwd();
const LOG_DIR = path.join(REPO_ROOT, '.thumbgate');
const LOG_PATH = path.join(LOG_DIR, 'cloud-egress.jsonl');

// Tool names that egress data to the cloud
const EGRESS_MATCHERS = [
  /^WebFetch$/,
  /^mcp__.*__(upload|send|publish|post)/i,
  /^Bash$/, // sub-checked for curl/wget below
];

function readToolUse() {
  // Claude Code passes hook payload via stdin as JSON
  let raw = '';
  try {
    raw = fs.readFileSync(0, 'utf8');
  } catch (_) {
    return null;
  }
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_) { return null; }
}

function isEgress(toolName, toolInput) {
  if (!toolName) return false;
  if (EGRESS_MATCHERS.some((re) => re.test(toolName))) {
    if (toolName === 'Bash') {
      const cmd = String(toolInput && toolInput.command || '');
      return /\b(curl|wget|http[s]?ie|httpx)\b/i.test(cmd) &&
             /https?:\/\//i.test(cmd);
    }
    return true;
  }
  return false;
}

function referencesLocalFile(toolInput) {
  const blob = JSON.stringify(toolInput || {});
  // Heuristic: any path that looks repo-local
  return /(["'])(\.\/|\/Users\/|\/home\/|src\/|\.env|secrets?|credentials?)/i.test(blob);
}

function logDecision(entry) {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + '\n');
  } catch (_) { /* never block on logging */ }
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
  if (process.env.THUMBGATE_CLOUD_EGRESS_OK === '1') {
    logDecision({ ts: new Date().toISOString(), decision: 'allow', reason: 'env-override' });
    return approve('Pre-approved via THUMBGATE_CLOUD_EGRESS_OK=1');
  }

  const payload = readToolUse();
  if (!payload) return approve('No hook payload available; pass-through.');

  const toolName = payload.tool_name || payload.toolName || '';
  const toolInput = payload.tool_input || payload.toolInput || {};

  if (!isEgress(toolName, toolInput)) {
    return approve('Not a cloud-egress tool call.');
  }

  if (!referencesLocalFile(toolInput)) {
    logDecision({ ts: new Date().toISOString(), tool: toolName, decision: 'allow', reason: 'no-local-payload' });
    return approve('Cloud egress without local file reference — allowed.');
  }

  const reason = `ThumbGate: about to send local repo content via ${toolName}. Approve cloud egress?`;
  logDecision({ ts: new Date().toISOString(), tool: toolName, decision: 'ask', reason });
  return block(reason);
}

try {
  main();
} catch (err) {
  // Never block the agent on a gate bug.
  console.error('[cloud-egress-confirm] internal error:', err && err.message);
  approve('Gate internal error; failing open.');
}
