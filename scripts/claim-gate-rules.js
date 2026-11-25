'use strict';

// AGENT-3667 item N: a thumbs-down on an unchecked status claim ("sign-in is refused", "a host is down") writes a rule by
// itself. ONE thumbs-down from a person adds a rule to <feedback dir>/claim-gate-rules.json; the Stop-time claim gate
// (claim-gate-stop.js, run by `thumbgate claim-stop-check` and the Cursor stop hook) then holds the next sentence that
// matches the rule until a real check from the same turn ran and its output is in the reply. Nobody edits a file.
//
// 2026-11-25 (Igor, from Cursor: "Three thumbs-downs did not create that rule"): the rule used to need two thumbs-downs
// with the same first four content words, so three differently worded thumbs-downs never added up. A thumbs-down that
// names a kind of claim (sign-in, host, ticket, deploy, fix) now writes a rule for that whole kind at once.
const fs = require('node:fs');
const path = require('node:path');

const FILE_NAME = 'claim-gate-rules.json';
const HUMAN_THRESHOLD = 1;
const STOP = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'it', 'its', 'on', 'in', 'at', 'to', 'of', 'for', 'and', 'or', 'that', 'this', 'with', 'you', 'said', 'say', 'says', 'claimed', 'stated', 'told', 'right', 'now', 'currently', 'still', 'again', 'just', 'so', 'but', 'not', 'no', 'without', 'checking', 'check', 'checked', 'verifying', 'verified', 'never', 'did', 'didnt', 'don', 'dont', 'i', 'me', 'my', 'we', 'our', 'wrong', 'bad', 'thumbs', 'down', 'up', 'that', 'what', 'when', 'because', 'before', 'after', 'any', 'first', 'unchecked', 'unverified', 'stale', 'guess', 'guessed', 'made', 'up']);
const COMPLAINT_RE = /\b(?:(?:do\s+not|don'?t|never|stop)\s+(?:say|saying|claim|claiming|state|stating|report|reporting|tell)|unless\s+(?:this\s+turn|you)\s+(?:\w+\s+){0,3}?(?:opened|ran|checked|verified|looked)|not\s+the\s+current\s+state|is\s+not\s+a\s+signed[\s-]*in|output\s+is\s+attached|without\s+(?:checking|verif\w*|looking|opening|running)|never\s+(?:checked|verified|opened|ran|looked)|didn'?t\s+(?:check|verify|open|run|look)|did\s+not\s+(?:check|verify|open|run|look)|unverified|unchecked|not\s+checked|stale|made\s+(?:that|it)\s+up|guess(?:ed)?|no\s+check|from\s+memory)\b/i;
// Words that make a sentence a status claim at all. Without one, a thumbs-down is about something else.
const STATE_WORD_RE = /\b(?:refus\w+|reject\w+|denied|down|up|offline|unreachable|unavailable|broken|blocked|failing|failed|expired|stuck|paused|closed|open|running|stopped|timing\s+out|erroring|not\s+working|logged\s+in|signed\s+in|merged|approved|passing|empty|missing)\b/i;

// Kinds of status claim. A thumbs-down that names one writes a rule for the whole kind, so the next claim of that kind is
// held however it is worded. `subject` must appear in the complaint; `pattern` is what the gate looks for in a reply.
const CLAIM_CLASSES = [
  {
    key: 'class:sign-in',
    subject: /\b(?:sign[\s-]*in|log[\s-]*in|logged\s+(?:in|out)|signed\s+(?:in|out)|session|auth\w*|credential\w*|password|2fa|sso|oauth)\b/i,
    pattern: '\\b(?:sign[\\s-]*in|log[\\s-]*in|logged\\s+(?:in|out)|signed\\s+(?:in|out)|session|auth\\w*|credentials?|password|sso|oauth|token)\\b[^.!?\\n]{0,60}?\\b(?:refus\\w*|reject\\w*|denied|fail\\w*|broken|blocked|expired|invalid|not\\s+working|works?|working|succeed\\w*|ok)\\b|\\b(?:refus\\w*|reject\\w*|denied|fail\\w*|blocked)\\b[^.!?\\n]{0,40}?\\b(?:sign[\\s-]*in|log[\\s-]*in|session|auth\\w*)\\b|\\b(?:is|am|are)\\s+(?:now\\s+)?(?:signed|logged)\\s+(?:in|out)\\b',
    message: 'A sign-in claim needs a check of the signed-in page or call this turn. A /health 200 is not a signed-in session.',
  },
  {
    key: 'class:host',
    subject: /\b(?:host|server|site|service|api|endpoint|domain|website|page|app|backend|database|db)\b[^.!?]{0,40}\b(?:down|up|unreachable|offline|unavailable|timing\s+out|erroring|5\d\d)\b|\b(?:down|unreachable|offline)\b[^.!?]{0,20}\b(?:host|server|site|service)\b/i,
    pattern: '\\b(?:host|server|site|service|api|endpoint|domain|website|backend|database|db|app)\\b[^.!?\\n]{0,60}?\\b(?:is|are|was|went|looks?|seems?)\\s+(?:still\\s+|now\\s+|currently\\s+)?(?:down|up|unreachable|offline|unavailable|timing\\s+out|erroring|returning\\s+5\\d\\d|healthy|back)\\b',
    message: 'A host up or down claim needs a request to that host this turn, with the status in the reply.',
  },
  {
    key: 'class:blocked',
    subject: /\b(?:ticket|issue|pr|pull\s+request|task|review|request|case|order|job)\b[^.!?]{0,40}\b(?:blocked|stuck|waiting|pending|on\s+hold|rejected|approved|closed)\b/i,
    pattern: '\\b(?:ticket|issue|pr|pull\\s+request|task|review|request|case|order|job|build)\\b[^.!?\\n]{0,60}?\\b(?:is|are|was|remains?)\\s+(?:still\\s+|now\\s+|currently\\s+)?(?:blocked|stuck|waiting|pending|on\\s+hold|rejected|approved|closed|open)\\b',
    message: 'A ticket or PR state claim needs a read of that ticket or PR this turn.',
  },
  {
    key: 'class:deployed',
    subject: /\b(?:deploy\w*|shipped|live|in\s+production|released|rolled\s+out)\b/i,
    pattern: '\\b(?:is|are|it\'?s|now|has\\s+been|have\\s+been|was)\\s+(?:now\\s+|fully\\s+)?(?:deployed|shipped|live|released|rolled\\s+out|in\\s+production)\\b',
    message: 'A deployed or live claim needs a live request this turn showing the new version.',
  },
  {
    key: 'class:fixed',
    subject: /\b(?:fixed|resolved|works\s+now|working\s+now|solved)\b/i,
    pattern: '\\b(?:is|are|it\'?s|now|has\\s+been|have\\s+been)\\s+(?:now\\s+|fully\\s+)?(?:fixed|resolved|solved|working)\\b|\\bworks\\s+now\\b',
    message: 'A fixed claim needs the failing check rerun this turn, with its output in the reply.',
  },
];

function claimClasses(text) {
  return CLAIM_CLASSES.filter((c) => c.subject.test(String(text || '')));
}

/** True when a thumbs-down is about something the agent SAID without checking, not about a command. */
function isClaimComplaint(text) {
  const raw = String(text || '');
  return COMPLAINT_RE.test(raw) && (claimClasses(raw).length > 0 || claimSentences(raw).length > 0);
}

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
  const now = new Date().toISOString();
  const classes = claimClasses(text);
  for (const cls of classes) {
    const ev = data.evidence[cls.key] || { human: 0, firstAt: now };
    ev.human += 1;
    ev.lastAt = now;
    ev.example = text.slice(0, 200);
    data.evidence[cls.key] = ev;
    if (ev.human >= HUMAN_THRESHOLD && !data.rules.some((r) => r.key === cls.key)) {
      const rule = {
        id: `claim-${cls.key.replace(/^class:/, '')}`,
        key: cls.key,
        pattern: cls.pattern,
        action: 'hold',
        requiresEvidence: true,
        source: 'human-thumbs-down',
        thumbsDown: ev.human,
        example: ev.example,
        message: `${cls.message} Do not state it unless this turn opened the page or ran the check and the output is in the reply. An earlier log is not the current state.`,
        createdAt: now,
      };
      data.rules.push(rule);
      made = made || rule;
    }
  }
  for (const sentence of classes.length ? [] : sentences) {
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
        requiresEvidence: true,
        message: 'Do not state outside state unless this turn opened the page or ran the check and attached the output. A health-page 200 is not a signed-in session; an earlier log is not the current state.',
        createdAt: new Date().toISOString(),
      };
      data.rules.push(made);
    }
    break; // one claim per thumbs-down, the first that reads like a status claim
  }
  fs.mkdirSync(feedbackDir, { recursive: true });
  fs.writeFileSync(filePath(feedbackDir), `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  return made ? { rule: made, rules: data.rules } : { counted: true };
}

module.exports = { FILE_NAME, HUMAN_THRESHOLD, CLAIM_CLASSES, readRules, recordFromFeedback, ruleFromSentence, claimSentences, claimClasses, isClaimComplaint };
