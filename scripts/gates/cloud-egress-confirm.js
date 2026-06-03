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
//     a repo-local file path, return decision=ask with a permission prompt.
//   - If the operator has pre-approved via env (THUMBGATE_CLOUD_EGRESS_OK=1),
//     allow.
//   - Logs every decision to .thumbgate/cloud-egress.jsonl for audit.
// -----------------------------------------------------------------------------

const fs = require('node:fs');
const path = require('node:path');

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
  } catch (err) {
    // No stdin or non-readable — gate runs in pass-through mode.
    return { _readError: err.message };
  }
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    return { _parseError: err.message };
  }
}

function isEgress(toolName, toolInput) {
  if (!toolName) return false;
  if (!EGRESS_MATCHERS.some((re) => re.test(toolName))) return false;
  if (toolName === 'Bash') {
    const cmd = String(toolInput?.command || '');
    return /\b(curl|wget|httpie|httpx)\b/i.test(cmd) &&
           /https?:\/\//i.test(cmd);
  }
  return true;
}

function referencesLocalFile(toolInput) {
  const blob = JSON.stringify(toolInput || {});
  // Heuristic: any path that looks repo-local
  return /["'](\.\/|\/Users\/|\/home\/|src\/|\.env|secrets?|credentials?)/i.test(blob);
}

function logDecision(entry) {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + '\n');
  } catch (err) {
    // Logging is best-effort. Surface to stderr but never block the agent.
    process.stderr.write(`[cloud-egress-confirm] log write failed: ${err.message}\n`);
  }
}

function approveOutput(reason) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: reason,
    },
  };
}

function askOutput(reason) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason: reason,
    },
  };
}

// Pure decision function — exported for tests. No I/O.
function decide({ env = {}, payload }) {
  if (env.THUMBGATE_CLOUD_EGRESS_OK === '1') {
    return {
      decision: 'allow',
      reason: 'Pre-approved via THUMBGATE_CLOUD_EGRESS_OK=1',
      output: approveOutput('Pre-approved via THUMBGATE_CLOUD_EGRESS_OK=1'),
    };
  }
  if (!payload || payload._readError || payload._parseError) {
    return {
      decision: 'allow',
      reason: 'No hook payload available; pass-through.',
      output: approveOutput('No hook payload available; pass-through.'),
    };
  }
  const toolName = payload.tool_name || payload.toolName || '';
  const toolInput = payload.tool_input || payload.toolInput || {};
  if (!isEgress(toolName, toolInput)) {
    return {
      decision: 'allow',
      reason: 'Not a cloud-egress tool call.',
      output: approveOutput('Not a cloud-egress tool call.'),
    };
  }
  if (!referencesLocalFile(toolInput)) {
    return {
      decision: 'allow',
      reason: 'Cloud egress without local file reference — allowed.',
      output: approveOutput('Cloud egress without local file reference — allowed.'),
      tool: toolName,
    };
  }
  const reason = `ThumbGate: about to send local repo content via ${toolName}. Approve cloud egress?`;
  return {
    decision: 'ask',
    reason,
    output: askOutput(reason),
    tool: toolName,
  };
}

function main() {
  const payload = readToolUse();
  const result = decide({ env: process.env, payload });
  if (result.tool || result.decision !== 'allow') {
    logDecision({
      ts: new Date().toISOString(),
      tool: result.tool || null,
      decision: result.decision,
      reason: result.reason,
    });
  }
  process.stdout.write(JSON.stringify(result.output) + '\n');
  process.exit(0);
}

module.exports = {
  decide,
  isEgress,
  referencesLocalFile,
  EGRESS_MATCHERS,
};

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`[cloud-egress-confirm] internal error: ${err.message}\n`);
    process.stdout.write(JSON.stringify(approveOutput('Gate internal error; failing open.')) + '\n');
    process.exit(0);
  }
}
