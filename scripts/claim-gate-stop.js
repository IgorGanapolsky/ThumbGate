#!/usr/bin/env node
'use strict';

/**
 * Stop hook: state-claim gate.
 *
 * A thumbs-down lesson ("never say a tab is closed without checking") used to be
 * stored and then ignored: nothing looked at the next reply. This hook closes that
 * loop. When the draft reply states the present condition of something outside the
 * conversation (a tab is open, a chat has not replied, nothing is running) and the
 * turn made no tool call to check it, and the sentence carries no label ("live",
 * "as of 12:44 PM", "not checked"), the stop is blocked once. The reason carries
 * the top relevant lessons from ThumbGate memory, so a lesson recorded yesterday
 * changes today's reply without the agent having to remember to look.
 *
 * Block-once: Claude Code re-runs a blocked Stop hook with `stop_hook_active: true`;
 * that run always allows, so a reply can never loop. Any internal error allows.
 *
 * Install (Claude Code, user or project settings.json):
 *   "hooks": { "Stop": [ { "hooks": [ { "type": "command",
 *     "command": "node /path/to/ThumbGate/scripts/claim-gate-stop.js" } ] } ] }
 * Disable with THUMBGATE_CLAIM_GATE=0.
 *
 * Replay a saved transcript to measure repeats:
 *   node scripts/claim-gate-stop.js --replay <transcript.jsonl> [--since <ISO time>]
 */

const fs = require('node:fs');
const path = require('node:path');

// Sentence patterns that assert the present condition of outside state.
const STATE_CLAIM_PATTERNS = [
  { kind: 'absence', re: /\b(?:nothing|no\s*one|nobody|none)\s+(?:is\s+|are\s+)?(?:watch\w*|runn\w*|open\w*|monitor\w*|listen\w*|show\w*|sent|pending|waiting|there|here|exist\w*|came|arrived)\b/i },
  { kind: 'no-reply', re: /\b(?:hasn'?t|has\s+not|haven'?t|have\s+not|still\s+hasn'?t|yet\s+to)\s+(?:replied|responded|answered|arrived|come\s+back|reached|opened|sent|run)\b/i },
  { kind: 'no-thing', re: /\bno\s+(?:\w+\s+){0,3}?(?:tab|window|session|reply|response|watcher|job|process|link|message|email|agent|app)s?\s+(?:is\s+|are\s+)?(?:open|running|exists?|found|there|yet|came|arrived|connected)\b/i },
  { kind: 'state', re: /\b(?:is|are|isn'?t|aren'?t|remains?|stays?|still|currently|now)\s+(?:\w+\s+){0,2}?(?:open|closed|running|stopped|down|sent|delivered|pending|waiting|blocked|refused|rejected|denied|unreachable|offline|unavailable|broken|expired|failing|failed|passing|merged|approved|connected|disconnected|missing|absent|empty|idle|stuck|paused|unread|replied|signed\s+in|logged\s+in)\b/i },
  { kind: 'done-by-other', re: /\b(?:has|have)\s+(?:already\s+)?(?:replied|responded|answered|sent|opened|closed|accepted|signed|paid|arrived|finished|completed|failed)\b/i },
  { kind: 'already', re: /\balready\s+(?:sent|open|closed|running|replied|delivered|merged|done)\b/i },
];

// A claim is labelled when the sentence says how fresh or how sure it is.
const LABEL_RE = new RegExp([
  String.raw`not\s+checked`, String.raw`unchecked`, String.raw`unverified`, String.raw`not\s+verified`,
  String.raw`(?:haven'?t|have\s+not|didn'?t|did\s+not)\s+(?:yet\s+)?(?:checked|verified|looked)`,
  String.raw`as\s+of\s+\d{1,2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?`,
  String.raw`as\s+of\s+(?:the\s+)?(?:last|my|this|that|earlier|today|now|just\s+now)`,
  String.raw`(?:checked|verified|confirmed|read|queried|looked)\s+(?:live|just\s+now|this\s+turn|at\s+\d{1,2}:\d{2})`,
  String.raw`live\s+(?:check|read|call|query|reading|state|api|screen)`,
  String.raw`\(live\)`,
  String.raw`per\s+(?:the\s+)?(?:check|output|log|script|api|screenshot|reading)`,
  String.raw`(?:saved|cached|old|earlier|last)\s+(?:reading|read|state|file|snapshot)`,
  String.raw`i\s+don'?t\s+know`,
].map((p) => `(?:${p})`).join('|'), 'i');
const LEADING_LIVE_RE = /^\s*(?:[-*>]\s*)?live\s*[:,—-]/i;

const HEDGE_RE = /\b(?:if|whether|would|could|should|might|may|unless|can'?t\s+tell|assuming|suppose)\b/i;

// Tool calls that do not look at the outside world, so they do not count as a check.
const STALE_PRONE_KINDS = new Set(['absence', 'no-reply', 'no-thing']);
// A tool call that only reads a health page or an old log looks at the outside world but not at the claim.
// "/health returned 200" does not show a signed-in session works; a log file is yesterday's state, not now.
const HEALTH_CALL_RE = /(?:curl|wget|fetch|http|get)\b.*\/(?:health|healthz|status|ping|ready|readyz|live|livez)\b/i;
const SESSION_WORDS_RE = /login|sign-?in|auth|session|cookie|token|account|dashboard/i;
const LOG_READ_RE = /\.log\b|journalctl|\/var\/log|\blogs?\/|\.jsonl?\b.*\b(?:tail|cat)\b|\b(?:tail|cat)\b.*\.jsonl?\b/i;
function isWeakCheck(call) {
  const summary = String((call && call.summary) || '');
  if (!summary) return false;
  if (HEALTH_CALL_RE.test(summary) && !SESSION_WORDS_RE.test(summary)) return true;
  return LOG_READ_RE.test(summary);
}

const NON_CHECK_TOOLS = new Set(['TodoWrite', 'ExitPlanMode', 'AskUserQuestion', 'EnterPlanMode', 'TaskStop', 'SendUserFile']);

function stripQuotedAndCode(text) {
  const out = [];
  let inFence = false;
  for (const line of String(text || '').split('\n')) {
    if (/^\s*```/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    if (/^\s*>/.test(line)) continue;
    out.push(line.replace(/`[^`]*`/g, ' ').replace(/"[^"]{3,200}"/g, ' '));
  }
  return out.join('\n');
}

function splitSentences(text) {
  return stripQuotedAndCode(text)
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.replace(/^[\s\-*#>\d.)]+/, '').trim())
    .filter((s) => s.length >= 8);
}

function isLabelled(sentence) {
  return LABEL_RE.test(sentence) || LEADING_LIVE_RE.test(sentence);
}

/** Unlabelled present-tense claims about outside state in `text`. */
function findStateClaims(text) {
  const claims = [];
  for (const sentence of splitSentences(text)) {
    if (sentence.endsWith('?')) continue;
    if (HEDGE_RE.test(sentence)) continue;
    // "I haven't opened it" is the agent disclosing its own gap, not a claim about outside state.
    const probe = sentence.replace(/\bI\s+(?:haven'?t|have\s+not|hadn'?t|didn'?t|did\s+not|never)\b[^,;]*/gi, ' ');
    const hit = STATE_CLAIM_PATTERNS.find((p) => p.re.test(probe));
    if (!hit) continue;
    if (isLabelled(sentence)) continue;
    claims.push({ kind: hit.kind, sentence: sentence.slice(0, 240) });
  }
  return claims;
}

/** Sentences that match a rule a person's thumbs-downs created (claim-gate-rules.json in the feedback dir). */
function findLearnedClaims(text, feedbackDir) {
  let rules = [];
  try { rules = require('./claim-gate-rules').readRules(feedbackDir || require('./feedback-paths').resolveFeedbackDir({ cwd: process.cwd() })).rules; } catch { return []; }
  const claims = [];
  for (const sentence of splitSentences(text)) {
    if (sentence.endsWith('?') || HEDGE_RE.test(sentence) || isLabelled(sentence)) continue;
    for (const rule of rules) {
      let hit = false;
      try { hit = new RegExp(rule.pattern, 'i').test(sentence); } catch { hit = false; }
      if (hit) { claims.push({ kind: 'learned', sentence: sentence.slice(0, 240), ruleId: rule.id, requiresEvidence: rule.requiresEvidence !== false, ruleMessage: rule.message || '' }); break; }
    }
  }
  return claims;
}

// The reply shows what the check returned: a code span or block, a link, an HTTP status, or an exit code.
const EVIDENCE_RE = /```|`[^`\n]{3,}`|https?:\/\/\S+|\b(?:HTTP|status|returned|got|exit(?:\s+code)?)\s*:?\s*[0-9]{1,3}\b|\b[1-5][0-9]{2}\s+(?:OK|Found|Unauthorized|Forbidden|Not\s+Found|Bad\s+Gateway|Service\s+Unavailable)\b/i;
function hasEvidence(text) {
  return EVIDENCE_RE.test(String(text || ''));
}

// Claude Code can take Stop feedback without printing a hook error. Older and unknown hosts ignore that shape, which
// would switch the gate off, so only a transcript from a version known to accept it gets it.
const FEEDBACK_SINCE = [2, 1, 163];
function acceptsStopFeedback(version) {
  const parts = String(version || '').split('.').map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part))) return false;
  const differs = FEEDBACK_SINCE.findIndex((least, i) => parts[i] !== least);
  return differs === -1 || parts[differs] > FEEDBACK_SINCE[differs];
}

/**
 * Decide on a draft reply.
 * @param {string} text the draft assistant text for this turn
 * @param {{toolNames?: string[], toolCalls?: object[], feedbackDir?: string}} options
 * @returns {{block: boolean, claims: object[], lessons: object[], reason: string|null, checked: boolean}}
 */
function evaluateDraft(text, options = {}) {
  const toolNames = Array.isArray(options.toolNames) ? options.toolNames : [];
  const toolCalls = Array.isArray(options.toolCalls) ? options.toolCalls : null;
  const checked = toolCalls
    ? toolCalls.some((call) => !NON_CHECK_TOOLS.has(call.name) && !isWeakCheck(call))
    : toolNames.some((name) => !NON_CHECK_TOOLS.has(name));
  // A tool call in the turn covers an ordinary state claim. A claim that something is
  // absent or has not replied goes stale in minutes ("hasn't replied yet" was true at
  // 12:42 and false at 12:44), so those need a label even when the turn ran a tool.
  // A learned rule (a person's thumbs-down) also wants the check's output IN the reply, not just a tool call somewhere.
  const evidenceInReply = hasEvidence(text);
  const claims = [...findStateClaims(text), ...findLearnedClaims(text, options.feedbackDir)]
    .filter((c) => !checked || STALE_PRONE_KINDS.has(c.kind) || (c.kind === 'learned' && c.requiresEvidence && !evidenceInReply));
  if (claims.length === 0) return { block: false, claims, lessons: [], reason: null, checked };

  // One line, and only the rule that fired: retrieved lessons were noise on screen.
  const rules = [...new Set(claims.filter((c) => c.ruleMessage).map((c) => c.ruleMessage))].join(' ');
  const sentence = String(claims[0].sentence).replace(/\s+/g, ' ').slice(0, 120);
  const more = claims.length > 1 ? ` (+${claims.length - 1} more)` : '';
  const reason = `ThumbGate claim gate: unchecked claim "${sentence}"${more}. Check it now, or label it "live", "as of <time>" or "not checked".${rules ? ` ${rules.replace(/\s+/g, ' ')}` : ''}`;
  return { block: true, claims, lessons: [], reason, checked };
}

function textOf(message) {
  const content = message && message.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
}

function isRealUserPrompt(entry) {
  if (!entry || entry.type !== 'user' || entry.isSidechain) return false;
  const content = entry.message && entry.message.content;
  if (typeof content === 'string') return content.trim().length > 0 && !content.trimStart().startsWith('<');
  if (!Array.isArray(content)) return false;
  if (content.some((b) => b && b.type === 'tool_result')) return false;
  const text = textOf(entry.message).trim();
  return text.length > 0 && !text.startsWith('<');
}

/** Split transcript entries into turns: the assistant text and tool names after each real user prompt. */
function collectTurns(entries) {
  const turns = [];
  let current = null;
  for (const entry of entries) {
    if (isRealUserPrompt(entry)) {
      current = { timestamp: entry.timestamp || null, text: [], tools: [], calls: [] };
      turns.push(current);
      continue;
    }
    if (!current || !entry || entry.type !== 'assistant' || entry.isSidechain) continue;
    const content = (entry.message && entry.message.content) || [];
    if (!Array.isArray(content)) continue;
    const t = textOf(entry.message);
    if (t) current.text.push(t);
    for (const block of content) {
      if (!block || block.type !== 'tool_use') continue;
      current.tools.push(block.name || 'tool');
      const input = block.input && typeof block.input === 'object' ? block.input : {};
      current.calls.push({ name: block.name || 'tool', summary: String(input.command || input.file_path || input.url || input.path || '').slice(0, 400) });
    }
    current.lastTimestamp = entry.timestamp || current.lastTimestamp;
  }
  return turns;
}

function readTranscript(file) {
  const entries = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { entries.push(JSON.parse(line)); } catch { /* skip a bad line */ }
  }
  return entries;
}

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

function main() {
  if (process.env.THUMBGATE_CLAIM_GATE === '0') return;
  let payload = {};
  try { payload = JSON.parse(readStdin() || '{}'); } catch { payload = {}; }
  if (payload.stop_hook_active === true) return; // block once, never loop

  const file = payload.transcript_path;
  let text = '';
  let toolNames = [];
  let toolCalls = null;
  let version = null;
  if (file && fs.existsSync(file)) {
    const entries = readTranscript(file);
    version = entries.map((entry) => entry && entry.version).filter(Boolean).pop();
    const turns = collectTurns(entries);
    const turn = turns[turns.length - 1];
    if (turn) { text = turn.text.join('\n'); toolNames = turn.tools; toolCalls = turn.calls; }
  } else {
    text = String(payload.last_assistant_message || '');
  }
  if (!text.trim()) return;

  const verdict = evaluateDraft(text, { toolNames, toolCalls, feedbackDir: process.env.THUMBGATE_FEEDBACK_DIR });
  if (!verdict.block) return;
  const out = acceptsStopFeedback(version)
    ? { hookSpecificOutput: { hookEventName: payload.hook_event_name === 'SubagentStop' ? 'SubagentStop' : 'Stop', additionalContext: verdict.reason } }
    : { decision: 'block', reason: verdict.reason };
  process.stdout.write(`${JSON.stringify(out)}\n`);
}

async function replay(file, since) {
  const turns = collectTurns(readTranscript(file)).filter((t) => !since || (t.timestamp && t.timestamp >= since));
  const rows = [];
  for (const turn of turns) {
    const text = turn.text.join('\n');
    if (!text.trim()) continue;
    const verdict = evaluateDraft(text, { toolNames: turn.tools, retrieve: () => [] });
    rows.push({ at: turn.timestamp, tools: turn.tools.length, flagged: verdict.block, claims: verdict.claims });
  }
  return rows;
}

if (path.resolve(process.argv[1] || '') === path.resolve(__filename)) {
  const args = process.argv.slice(2);
  if (args[0] === '--replay') {
    const since = args.includes('--since') ? args[args.indexOf('--since') + 1] : null;
    replay(args[1], since).then((rows) => {
      const flagged = rows.filter((r) => r.flagged);
      console.log(JSON.stringify({ turns: rows.length, flagged: flagged.length, since: since || null }));
      for (const r of flagged) console.log(r.at, r.claims.map((c) => `[${c.kind}] ${c.sentence}`).join(' | ').slice(0, 300));
    });
  } else {
    try { main(); } catch { /* never crash the agent */ }
  }
}

module.exports = {
  hasEvidence,
  isWeakCheck,
  findLearnedClaims,
  STATE_CLAIM_PATTERNS,
  LABEL_RE,
  findStateClaims,
  evaluateDraft,
  collectTurns,
  isLabelled,
  main,
};
