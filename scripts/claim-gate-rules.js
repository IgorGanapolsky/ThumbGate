'use strict';

// AGENT-3667 item N: a thumbs-down on an unchecked status claim ("sign-in is refused", "a host is down") writes a rule by
// itself. Two thumbs-downs from a person on the same claim add a rule to <feedback dir>/claim-gate-rules.json; the
// Stop-time claim gate (claim-gate-stop.js, opt-in) then holds the next sentence that matches the rule until a real
// check from the same turn is attached. Nobody edits a file.
const fs = require('node:fs');
const path = require('node:path');

const FILE_NAME = 'claim-gate-rules.json';
const HUMAN_THRESHOLD = 2;
const STOP = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'it', 'its', 'on', 'in', 'at', 'to', 'of', 'for', 'and', 'or', 'that', 'this', 'with', 'you', 'said', 'say', 'says', 'claimed', 'stated', 'told', 'right', 'now', 'currently', 'still', 'again', 'just', 'so', 'but', 'not', 'no', 'without', 'checking', 'check', 'checked', 'verifying', 'verified', 'never', 'did', 'didnt', 'don', 'dont', 'i', 'me', 'my', 'we', 'our', 'wrong', 'bad', 'thumbs', 'down', 'up', 'that', 'what', 'when', 'because', 'before', 'after', 'any', 'first', 'unchecked', 'unverified', 'stale', 'guess', 'guessed', 'made', 'up']);
const COMPLAINT_RE = /\b(?:without\s+(?:checking|verif\w*|looking|opening|running)|never\s+(?:checked|verified|opened|ran|looked)|didn'?t\s+(?:check|verify|open|run|look)|did\s+not\s+(?:check|verify|open|run|look)|unverified|unchecked|not\s+checked|stale|made\s+(?:that|it)\s+up|guess(?:ed)?|no\s+check|from\s+memory)\b/i;
// Words that make a sentence a status claim at all. Without one, a thumbs-down is about something else.
const STATE_WORD_RE = /\b(?:refus\w+|reject\w+|denied|down|up|offline|unreachable|unavailable|broken|blocked|failing|failed|expired|stuck|paused|closed|open|running|stopped|timing\s+out|erroring|not\s+working|logged\s+in|signed\s+in|merged|approved|passing|empty|missing)\b/i;

function filePath(feedbackDir) {
  return path.join(feedbackDir, FILE_NAME);
}

function readRules(feedbackDir) {
  try {
    const data = JSON.parse(fs.readFileSync(filePath(feedbackDir), 'utf8'));
    return data && Array.isArray(data.rules) ? data : { version: 1, rules: [], evidence: {} };
  } catch {
    return { version: 1, rules: [], evidence: {} };
  }
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The sentence(s) a thumbs-down is about: quoted text first, then any status-claim-looking clause. */
function claimSentences(text) {
  const raw = String(text || '');
  const out = [];
  for (const m of raw.matchAll(/["“'‘]([^"”’']{8,200})["”’']/g)) out.push(m[1]);
  for (const part of raw.split(/(?<=[.!?;])\s+|\n+|,\s+(?:and|but)\s+/)) {
    if (part.length >= 8 && part.length <= 240) out.push(part);
  }
  return out.filter((s) => STATE_WORD_RE.test(s));
}

function contentTokens(sentence) {
  return String(sentence).toLowerCase().replace(/sign[\s-]*in/g, 'signin').replace(/log[\s-]*in/g, 'login')
    .split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w));
}

/** Rule key and an order-preserving pattern built from the claim's content words. */
function ruleFromSentence(sentence) {
  const tokens = contentTokens(sentence).slice(0, 4);
  if (tokens.length < 2) return null;
  const parts = tokens.map((t) => (t === 'signin' ? 'sign[\\s-]*in' : t === 'login' ? 'log[\\s-]*in' : `${escapeRe(t)}\\w*`));
  return { key: tokens.join(' '), pattern: parts.join('(?:\\W+\\w+){0,4}?\\W+') };
}

/**
 * Called on a negative feedback event. Returns {rule} when this thumbs-down made a new rule, {counted} otherwise.
 */
function recordFromFeedback(event, feedbackDir) {
  if (!event || !feedbackDir) return null;
  const origin = event.reviewOrigin || 'agent';
  if (origin !== 'human') return null;
  const text = [event.whatWentWrong, event.context].filter(Boolean).join('. ');
  if (!COMPLAINT_RE.test(text)) return null;
  const sentences = claimSentences(text);
  let made = null;
  const data = readRules(feedbackDir);
  for (const sentence of sentences) {
    const spec = ruleFromSentence(sentence);
    if (!spec) continue;
    const ev = data.evidence[spec.key] || { human: 0, firstAt: new Date().toISOString() };
    ev.human += 1;
    ev.lastAt = new Date().toISOString();
    ev.example = sentence.slice(0, 200);
    data.evidence[spec.key] = ev;
    if (ev.human >= HUMAN_THRESHOLD && !data.rules.some((r) => r.key === spec.key)) {
      made = {
        id: `claim-${spec.key.replace(/ /g, '-')}`,
        key: spec.key,
        pattern: spec.pattern,
        action: 'hold',
        source: 'human-thumbs-down',
        thumbsDown: ev.human,
        example: ev.example,
        message: 'Do not state outside state unless this turn opened the page or ran the check and attached the output. A health-page 200 is not a signed-in session; an earlier log is not the current state.',
        createdAt: new Date().toISOString(),
      };
      data.rules.push(made);
    }
    break; // one claim per thumbs-down, the first that reads like a status claim
  }
  fs.mkdirSync(feedbackDir, { recursive: true });
  fs.writeFileSync(filePath(feedbackDir), `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  return made ? { rule: made } : { counted: true };
}

module.exports = { FILE_NAME, HUMAN_THRESHOLD, readRules, recordFromFeedback, ruleFromSentence, claimSentences };
