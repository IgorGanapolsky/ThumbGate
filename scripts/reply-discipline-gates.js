#!/usr/bin/env node
'use strict';

/**
 * reply-discipline-gates.js — two of the owner's anti-babysitting laws as
 * hook gates on what the agent says to the person.
 *
 *   pre  (PreToolUse on mcp__hearthbot__post_message / request_decision /
 *        edit_message, the tools Claude project threads use to reply):
 *     - deny a reply that hands the person a manual step ("please paste",
 *       "you need to", "sign in and"); 2FA / verification codes are exempt;
 *     - deny a completion claim ("done", "deployed", "verified") when nothing
 *       in the current turn proves it (patterns from hook-stop-anti-claim.js).
 *   stop (Stop): block once when the final plain-text reply hands over a
 *        manual step.
 *
 * Off unless THUMBGATE_PR_DISCIPLINE=1 or <project>/config/pr-discipline.json
 * has {"enabled": true}. Fails open on any internal error.
 */

const fs = require('node:fs');
const path = require('node:path');

const REPLY_TOOLS = new Set([
  'mcp__hearthbot__post_message',
  'mcp__hearthbot__request_decision',
  'mcp__hearthbot__edit_message',
]);

// Phrases that hand the person work the agent should do itself.
const MANUAL_STEP_PATTERNS = [
  /\bplease\s+(?:paste|run|click|open|upload|copy|send me|share|check|install|log ?in|sign ?in|restart|add|enable|set|configure|approve)\b/i,
  /\byou(?:'ll| will)?\s+need\s+to\b/i,
  /\byou\s+(?:have|must|should)\s+to?\s*(?:run|paste|click|open|sign|log|upload|copy|install|restart|configure)\b/i,
  /\bsign\s+in\s+and\b/i,
  /\blog\s+in\s+and\b/i,
  /\bcan\s+you\s+(?:paste|run|click|open|upload|copy|send|share|install|restart|sign|log)\b/i,
  /\bcould\s+you\s+(?:paste|run|click|open|upload|copy|send|share|install|restart|sign|log)\b/i,
  /\brun\s+(?:this|the following)\s+(?:command|on your)\b/i,
];
const MANUAL_STEP_EXEMPT = /\b(?:2fa|two[-\s]factor|mfa|one[-\s]time\s+code|verification\s+code|passkey|authenticator)\b/i;


function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

function parseJson(text, fallback = {}) {
  try { return JSON.parse(text); } catch { return fallback; }
}

function loadConfig(options = {}) {
  const env = options.env || process.env;
  const dirs = [options.projectDir, env.CLAUDE_PROJECT_DIR, options.cwd, process.cwd()].filter(Boolean);
  for (const dir of dirs) {
    const file = path.join(dir, 'config', 'pr-discipline.json');
    if (fs.existsSync(file)) {
      const cfg = parseJson(fs.readFileSync(file, 'utf8'), {});
      return { ...cfg, enabled: cfg.enabled === true || env.THUMBGATE_PR_DISCIPLINE === '1' };
    }
  }
  return { enabled: env.THUMBGATE_PR_DISCIPLINE === '1' };
}

function findManualStep(text) {
  const t = String(text || '');
  if (!t || MANUAL_STEP_EXEMPT.test(t)) return null;
  for (const p of MANUAL_STEP_PATTERNS) {
    const m = t.match(p);
    if (m) return m[0];
  }
  return null;
}

function replyTextFromInput(toolName, input = {}) {
  if (toolName === 'mcp__hearthbot__request_decision') {
    const opts = Array.isArray(input.options) ? input.options.map((o) => `${o.label || ''} ${o.consequence || ''}`) : [];
    return [input.question, input.reason, ...opts].filter(Boolean).join('\n');
  }
  return String(input.text || '');
}

/** Tool calls and results since the person's last message, as one string. */
function currentTurnEvidence(transcriptPath) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return '';
  let lines;
  try { lines = fs.readFileSync(transcriptPath, 'utf8').trim().split('\n'); } catch { return ''; }
  const parts = [];
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const entry = parseJson(lines[i], null);
    if (!entry) continue;
    const content = entry.message && Array.isArray(entry.message.content) ? entry.message.content : [];
    if (entry.type === 'user') {
      const isToolResult = content.some((b) => b && b.type === 'tool_result');
      if (!isToolResult) break; // reached the person's message: turn start
      for (const b of content) {
        if (b && b.type === 'tool_result') {
          const c = Array.isArray(b.content) ? b.content.map((x) => x.text || '').join('\n') : String(b.content || '');
          parts.push(c.slice(0, 2000));
        }
      }
    } else if (entry.type === 'assistant') {
      for (const b of content) {
        if (b && b.type === 'tool_use') {
          const inp = b.input || {};
          parts.push(`${b.name}: ${inp.command || inp.file_path || inp.url || JSON.stringify(inp).slice(0, 300)}`);
        }
      }
    }
  }
  return parts.join('\n');
}

function evaluateReply(toolName, input, payload = {}, deps = {}) {
  const text = replyTextFromInput(toolName, input);
  const manual = findManualStep(text);
  if (manual) {
    return {
      deny: true,
      rule: 'no-manual-steps',
      reason: `ThumbGate anti-babysitting: this reply hands the person a manual step ("${manual}"). Do the step yourself with your tools (MCP, connector, Remote Control, browser). If a safety rule truly blocks it, say so in one line without a to-do list. 2FA or a verification code is the only exception.`,
    };
  }
  const anti = deps.antiClaim || require('./hook-stop-anti-claim');
  const claim = anti.findClaim(text);
  if (claim) {
    const evidence = `${text}\n${currentTurnEvidence(payload.transcript_path)}`;
    if (!anti.hasProof(evidence)) {
      return {
        deny: true,
        rule: 'proof-before-claim',
        reason: `ThumbGate proof-before-claim: the reply claims "${claim}" but this turn ran nothing that proves it. Run the check (tests, curl, the PR's checks) in this turn and quote its output, or label the work as partial.`,
      };
    }
  }
  return { deny: false };
}

function lastAssistantText(transcriptPath) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return '';
  const lines = fs.readFileSync(transcriptPath, 'utf8').trim().split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const entry = parseJson(lines[i], null);
    if (entry && entry.type === 'assistant' && entry.message && Array.isArray(entry.message.content)) {
      const text = entry.message.content.filter((b) => typeof b.text === 'string').map((b) => b.text).join('\n');
      if (text) return text;
    }
  }
  return '';
}

async function main(mode = process.argv[2], options = {}) {
  const payload = parseJson(options.stdin !== undefined ? options.stdin : readStdin(), {});
  const out = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
  if (!loadConfig({ cwd: payload.cwd, env: options.env }).enabled) { out({}); return 0; }
  try {
    if (mode === 'pre' && REPLY_TOOLS.has(payload.tool_name)) {
      const r = evaluateReply(payload.tool_name, payload.tool_input || {}, payload, options);
      out(r.deny ? { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: r.reason } } : {});
    } else if (mode === 'stop' && payload.stop_hook_active !== true) {
      const manual = findManualStep(lastAssistantText(payload.transcript_path));
      out(manual ? { decision: 'block', reason: `ThumbGate anti-babysitting: your last reply hands the person a manual step ("${manual}"). Do it yourself or say in one line what blocks it.` } : {});
    } else out({});
  } catch (err) {
    process.stderr.write(`reply-discipline-gates: ${err && err.message}\n`);
    out({});
  }
  return 0;
}

module.exports = {
  REPLY_TOOLS,
  MANUAL_STEP_PATTERNS,
  loadConfig,
  findManualStep,
  replyTextFromInput,
  currentTurnEvidence,
  evaluateReply,
  lastAssistantText,
  main,
};

if (require.main === module) {
  main().then((code) => { process.exitCode = code; });
}
