#!/usr/bin/env node
'use strict';

/**
 * Stop hook: anti-claim enforcement.
 *
 * Scans the assistant's most recent turn (assistant text + same-turn tool_use
 * blocks) and blocks the "deployed / live / done / fixed / ready" claim
 * unless that same turn included a proof tool call (curl / grep / test).
 *
 * Why: CLAUDE.md anti-lying directive ("Never claim fix done until
 * committed+pushed. Never claim 'ready' without running e2e.") was
 * aspirational, not enforced. Per CEO 2026-05-13 feedback after a session in
 * which 5+ unverified claims slipped through, this is the harness-level
 * enforcement that ends the recurring trust-burn pattern. ThumbGate-on-
 * ThumbGate dogfood — we are the prevention-rule generator and a perfect
 * customer for our own gate.
 *
 * Wires through .claude/settings.json Stop hooks list. Always exits 0
 * (informational): the goal is to surface a system reminder in the next
 * turn so the agent corrects mid-conversation rather than to hard-block
 * the turn that already happened.
 *
 * Stdin: Claude Code passes the hook payload as JSON on stdin. We read
 * `transcript_path` to locate the JSONL session log and scan the last
 * assistant message.
 *
 * Stdout: any text printed is shown to the agent on the next turn.
 */

const fs = require('node:fs');

// Lie-phrase patterns. These match common "claim of completion" wording
// the agent emits without verification. Word-boundary anchored to avoid
// false positives ("ready-made", "live-streaming", etc).
const CLAIM_PATTERNS = [
  /\bis\s+live\b/i,
  /\bnow\s+live\b/i,
  /\bgoing\s+live\b/i,
  /\bdeployed\b(?!\s*(yet|to\s+staging|on\s+a\s+branch))/i,
  /\b(?:is|are|it'?s)\s+(?:now\s+)?(?:fully\s+)?(?:fixed|resolved|merged|shipped)\b/i,
  /\bproduction[-\s]ready\b/i,
  /\beverything\s+(?:is\s+)?(?:done|working|ready)\b/i,
];

// Proof-of-verification patterns. If the SAME turn included one of these
// tool calls or shell command tokens, the claim is considered backed and
// the hook stays silent.
const PROOF_PATTERNS = [
  /\bcurl\b/,
  /\bgh\s+pr\s+(?:view|checks|status)\b/,
  /\bgh\s+run\s+view\b/,
  /\bgh\s+api\b/,
  /\bnode\s+--test\b/,
  /\bnpm\s+(?:run\s+)?test\b/,
  /\bnpm\s+pack\b/,
  /\bjest\b/,
  /\bmocha\b/,
  /\bpytest\b/,
  /\bplaywright\b/,
  /\bgrep\b/,
  /Read\s*\(/, // Claude Code Read tool call
  /Bash\s*\(/, // Claude Code Bash tool call
];

function readLastAssistantTurn(transcriptPath) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return null;
  let content;
  try {
    content = fs.readFileSync(transcriptPath, 'utf8');
  } catch {
    return null;
  }
  const lines = content.trim().split('\n');
  // Walk backwards to find the last assistant message
  for (let i = lines.length - 1; i >= 0; i--) {
    const raw = lines[i].trim();
    if (!raw) continue;
    let entry;
    try {
      entry = JSON.parse(raw);
    } catch {
      continue;
    }
    if (entry.type === 'assistant' && entry.message) {
      return entry.message;
    }
  }
  return null;
}

function extractText(message) {
  if (!message || !Array.isArray(message.content)) return '';
  return message.content
    .filter((b) => b && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n');
}

function extractToolUseSummary(message) {
  if (!message || !Array.isArray(message.content)) return '';
  return message.content
    .filter((b) => b && b.type === 'tool_use')
    .map((b) => {
      const name = b.name || 'tool';
      let summary = '';
      if (b.input && typeof b.input === 'object') {
        if (typeof b.input.command === 'string') summary = b.input.command;
        else if (typeof b.input.file_path === 'string') summary = b.input.file_path;
        else if (typeof b.input.query === 'string') summary = b.input.query;
        else summary = JSON.stringify(b.input).slice(0, 200);
      }
      return `${name}: ${summary}`;
    })
    .join('\n');
}

function findClaim(text) {
  for (const p of CLAIM_PATTERNS) {
    const m = text.match(p);
    if (m) return m[0];
  }
  return null;
}

function hasProof(combined) {
  return PROOF_PATTERNS.some((p) => p.test(combined));
}

function readStdinSync() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function main() {
  const raw = readStdinSync();
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = {};
  }

  const transcriptPath = payload.transcript_path || process.env.CLAUDE_TRANSCRIPT_PATH;
  const message = readLastAssistantTurn(transcriptPath);
  if (!message) return; // no transcript visible; nothing to check

  const text = extractText(message);
  const toolUseSummary = extractToolUseSummary(message);
  const claim = findClaim(text);
  if (!claim) return; // no completion claim made; silent

  const proofText = `${text}\n${toolUseSummary}`;
  if (hasProof(proofText)) return; // claim backed by proof in same turn

  // Surface a system reminder for the NEXT turn. Do not hard-block.
  const reminder = [
    '⚠️ ThumbGate anti-claim gate: previous turn claimed completion',
    `   ("${claim}") without a proof tool call in the same message.`,
    '   Per CLAUDE.md anti-lying: never claim "done / live / deployed / fixed"',
    '   without curl / grep / test output in the SAME turn.',
    '   If the work really is verified, re-state the claim with the proof.',
    '   If not, retract and run the verification before re-asserting.',
  ].join('\n');
  process.stdout.write(reminder + '\n');
}

if (require.main === module) {
  try {
    main();
  } catch {
    // never crash the agent
  }
}

module.exports = {
  CLAIM_PATTERNS,
  PROOF_PATTERNS,
  findClaim,
  hasProof,
  extractText,
  extractToolUseSummary,
};
