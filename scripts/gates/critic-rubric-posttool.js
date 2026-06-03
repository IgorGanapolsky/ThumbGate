#!/usr/bin/env node
'use strict';

// scripts/gates/critic-rubric-posttool.js
// -----------------------------------------------------------------------------
// PostToolUse hook: auto-judge a coding agent's tool-call result against a
// fixed rubric and capture an automatic thumbs-down (with structured context)
// when any rubric clause fails. Closes the RLHF loop without requiring a human
// to click thumbs-down on every miss.
//
// Pattern source: "Critic/Rubric" from the dynamic-workflows analysis
// (l5rae4LMKBc) — a separate agent attacks the work against a fixed rubric.
// Pairwise comparison and self-evaluation by the SAME agent introduce
// self-preferential bias; an independent critic does not.
//
// Wire into .claude/settings.json:
//   "hooks": {
//     "PostToolUse": [
//       { "matcher": "Bash",     "command": "node scripts/gates/critic-rubric-posttool.js" },
//       { "matcher": "Edit",     "command": "node scripts/gates/critic-rubric-posttool.js" },
//       { "matcher": "Write",    "command": "node scripts/gates/critic-rubric-posttool.js" },
//       { "matcher": "WebFetch", "command": "node scripts/gates/critic-rubric-posttool.js" }
//     ]
//   }
//
// Rubric is a list of pure predicates over { tool_name, tool_input, tool_result }.
// Each clause returns { pass: bool, reason: string }. A clause failing emits a
// jsonl auto-feedback entry to .thumbgate/auto-feedback.jsonl which the normal
// feedback → memory → prevention-rule pipeline picks up.
// -----------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');

const REPO_ROOT = process.env.THUMBGATE_PROJECT_DIR || process.cwd();
const LOG_DIR = path.join(REPO_ROOT, '.thumbgate');
const AUTO_FEEDBACK_LOG = path.join(LOG_DIR, 'auto-feedback.jsonl');
const RUBRIC_DECISIONS_LOG = path.join(LOG_DIR, 'rubric-decisions.jsonl');

// ---------------------------------------------------------------------------
// Default rubric. Operators can extend by writing .thumbgate/rubric.js that
// exports `{ rubric: [...] }`. Each clause is a pure function — no I/O.
// ---------------------------------------------------------------------------
const DEFAULT_RUBRIC = [
  {
    id: 'no-secret-write',
    severity: 'critical',
    check: ({ tool_name, tool_input }) => {
      if (tool_name !== 'Write' && tool_name !== 'Edit') return { pass: true };
      const target = String(tool_input.file_path || '');
      const content = String(tool_input.content || tool_input.new_string || '');
      const secretPath = /(?:^|[\/\\.])(\.env(?:\.[a-z]+)?|secrets?|credentials?|id_rsa)(?:$|[\/\\.])|\.pem$/i.test(target);
      const secretBody = /(sk_live_[A-Za-z0-9]{8,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})/.test(content);
      if (secretPath && content.length > 0) {
        return { pass: false, reason: `Write to apparent secret path: ${target}` };
      }
      if (secretBody) {
        return { pass: false, reason: `File body contains live-looking credential (sk_live_/sk-/AKIA prefix)` };
      }
      return { pass: true };
    },
  },
  {
    id: 'no-destructive-bash',
    severity: 'critical',
    check: ({ tool_name, tool_input }) => {
      if (tool_name !== 'Bash') return { pass: true };
      const cmd = String(tool_input.command || '');
      if (/\brm\s+(-[a-z]*r[a-z]*f|--recursive\s+--force)\s+\/(?!tmp|var\/folders)/.test(cmd)) {
        return { pass: false, reason: `Recursive rm against system path: ${cmd.slice(0, 120)}` };
      }
      if (/\bgit\s+push\s+(--force|-f)(?!\-with\-lease)\b.*\b(main|master|production)\b/.test(cmd)) {
        return { pass: false, reason: `Force push to protected branch without --force-with-lease` };
      }
      return { pass: true };
    },
  },
  {
    id: 'no-bare-curl-pipe-sh',
    severity: 'high',
    check: ({ tool_name, tool_input }) => {
      if (tool_name !== 'Bash') return { pass: true };
      const cmd = String(tool_input.command || '');
      if (/\b(curl|wget)\b[^|]*\|\s*(sh|bash|zsh)\b/.test(cmd)) {
        return { pass: false, reason: `Piping remote content to a shell: ${cmd.slice(0, 120)}` };
      }
      return { pass: true };
    },
  },
  {
    id: 'edit-result-not-empty',
    severity: 'low',
    check: ({ tool_name, tool_result }) => {
      if (tool_name !== 'Edit' && tool_name !== 'Write') return { pass: true };
      const r = String(tool_result || '');
      if (/no changes|nothing to do/i.test(r)) {
        return { pass: false, reason: `Edit/Write reported no-op — likely missed the target.` };
      }
      return { pass: true };
    },
  },
];

function loadOperatorRubric() {
  const operatorPath = path.join(REPO_ROOT, '.thumbgate', 'rubric.js');
  if (!fs.existsSync(operatorPath)) return [];
  try {
    const mod = require(operatorPath);
    return Array.isArray(mod.rubric) ? mod.rubric : [];
  } catch (err) {
    appendLog(RUBRIC_DECISIONS_LOG, {
      ts: new Date().toISOString(),
      level: 'warn',
      msg: `Failed to load operator rubric: ${err.message}`,
    });
    return [];
  }
}

function appendLog(file, entry) {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(file, JSON.stringify(entry) + '\n');
  } catch (_) { /* never block */ }
}

function readPayload() {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch (_) { return null; }
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_) { return null; }
}

function evaluateRubric(payload) {
  const rubric = [...DEFAULT_RUBRIC, ...loadOperatorRubric()];
  const ctx = {
    tool_name: payload.tool_name || payload.toolName || '',
    tool_input: payload.tool_input || payload.toolInput || {},
    tool_result: payload.tool_response || payload.tool_result || payload.toolResult || '',
  };
  const failures = [];
  for (const clause of rubric) {
    if (!clause || typeof clause.check !== 'function') continue;
    let r;
    try { r = clause.check(ctx); } catch (err) {
      appendLog(RUBRIC_DECISIONS_LOG, {
        ts: new Date().toISOString(),
        level: 'warn',
        clause: clause.id,
        msg: `Clause threw: ${err.message}`,
      });
      continue;
    }
    if (!r || r.pass === false) {
      failures.push({ id: clause.id, severity: clause.severity || 'medium', reason: r && r.reason });
    }
  }
  return { ctx, failures };
}

function captureAutoFeedback({ ctx, failures }) {
  if (failures.length === 0) return;
  const entry = {
    ts: new Date().toISOString(),
    source: 'critic-rubric-posttool',
    feedback: 'down',
    tool: ctx.tool_name,
    failures,
    context: {
      tool_input: ctx.tool_input,
      tool_result: typeof ctx.tool_result === 'string'
        ? ctx.tool_result.slice(0, 800)
        : JSON.stringify(ctx.tool_result || '').slice(0, 800),
    },
    severity: failures.some((f) => f.severity === 'critical') ? 'critical'
      : failures.some((f) => f.severity === 'high') ? 'high'
      : 'medium',
  };
  appendLog(AUTO_FEEDBACK_LOG, entry);
  return entry;
}

function main() {
  const payload = readPayload();
  if (!payload) { process.exit(0); }

  const { ctx, failures } = evaluateRubric(payload);
  appendLog(RUBRIC_DECISIONS_LOG, {
    ts: new Date().toISOString(),
    tool: ctx.tool_name,
    failures: failures.map((f) => f.id),
  });

  if (failures.length === 0) {
    process.exit(0);
  }

  const entry = captureAutoFeedback({ ctx, failures });

  // PostToolUse hooks can return structured output to surface a warning back
  // to the agent (Anthropic's hook protocol). This is advisory — the action
  // already happened — but it adds a visible breadcrumb in the agent loop.
  const summary = failures.map((f) => `[${f.severity}] ${f.id}: ${f.reason || 'failed'}`).join('; ');
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: `ThumbGate critic-rubric flagged this tool call: ${summary}. Auto-thumbs-down captured (severity=${entry.severity}). See .thumbgate/auto-feedback.jsonl.`,
    },
  }));
  process.exit(0);
}

// Exported for unit tests. main() runs only when this file is the entry point —
// not when required from a test.
module.exports = { DEFAULT_RUBRIC, evaluateRubric };

if (require('path').resolve(process.argv[1] || '') === require('path').resolve(__filename)) {
  try {
    main();
  } catch (err) {
    console.error('[critic-rubric-posttool] internal error:', err && err.message);
    process.exit(0); // never block the agent on a gate bug
  }
}
